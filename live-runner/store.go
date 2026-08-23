package liverunner

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"sync"
	"time"
)

const sessionRecordVersionV1 = 1

var (
	ErrSessionIDReuseV1    = errors.New("runner_session_id_reuse")
	ErrRequestIDReuseV1    = errors.New("request_id_reuse")
	ErrRequestSupersededV1 = errors.New("request_id_superseded")
	ErrSessionTerminalV1   = errors.New("session_terminal")
)

type GrantAuditV1 struct {
	ID           string   `json:"id"`
	Operations   []string `json:"operations"`
	SecretSHA256 string   `json:"secret_sha256"`
	ExpiresAt    string   `json:"expires_at"`
}

type SessionRecordV1 struct {
	Version              int             `json:"version"`
	BrokerSessionID      string          `json:"broker_session_id"`
	RunnerSessionID      string          `json:"runner_session_id"`
	CreateFingerprint    string          `json:"create_fingerprint"`
	State                string          `json:"state"`
	Stopping             bool            `json:"stopping,omitempty"`
	PendingCloseReason   string          `json:"pending_close_reason,omitempty"`
	RuntimePublic        RuntimePublicV1 `json:"runtime_public"`
	GrantAudit           GrantAuditV1    `json:"grant_audit"`
	UsageTotal           uint64          `json:"usage_total"`
	LastSequence         uint64          `json:"last_sequence"`
	PendingEvents        []RunnerEventV1 `json:"pending_events"`
	CloseReason          string          `json:"close_reason,omitempty"`
	IntegritySHA256      string          `json:"integrity_sha256"`
	WrappedKeyNonce      string          `json:"wrapped_key_nonce,omitempty"`
	WrappedKeyCiphertext string          `json:"wrapped_key_ciphertext,omitempty"`
	SecretNonce          string          `json:"secret_nonce,omitempty"`
	SecretCiphertext     string          `json:"secret_ciphertext,omitempty"`
}

type SessionSecretsV1 struct {
	CreateRequest  RunnerCreateRequestV1       `json:"create_request"`
	CreateResponse RunnerCreateResponseV1      `json:"create_response"`
	CurrentKeyID   string                      `json:"current_key_request_id,omitempty"`
	KeyIssues      map[string]StoredKeyIssueV1 `json:"key_issues"`
}

type StoredKeyIssueV1 struct {
	Fingerprint string                   `json:"fingerprint"`
	Request     StreamKeyIssueRequestV1  `json:"request"`
	Response    StreamKeyIssueResponseV1 `json:"response"`
}

type EncryptedFileSessionStoreV1 struct {
	dir  string
	aead cipher.AEAD
	key  []byte
	mu   sync.Mutex
}

func NewEncryptedFileSessionStoreV1(dir string, key []byte) (*EncryptedFileSessionStoreV1, error) {
	if dir == "" || len(key) != 32 {
		return nil, errors.New("state directory and 32-byte encryption key are required")
	}
	encryptionKey := deriveKeyV1(key, "session-store/encryption/v1")
	integrityKey := deriveKeyV1(key, "session-store/integrity/v1")
	aead, err := newAESGCMV1(encryptionKey)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create session state directory: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, fmt.Errorf("secure session state directory: %w", err)
	}
	return &EncryptedFileSessionStoreV1{dir: dir, aead: aead, key: integrityKey}, nil
}

func (s *EncryptedFileSessionStoreV1) CreateOrReplay(request RunnerCreateRequestV1, response RunnerCreateResponseV1) (SessionRecordV1, SessionSecretsV1, bool, error) {
	if err := ValidateCreateRequestV1(request); err != nil {
		return SessionRecordV1{}, SessionSecretsV1{}, false, err
	}
	if err := ValidateCreateResponseV1(response); err != nil {
		return SessionRecordV1{}, SessionSecretsV1{}, false, err
	}
	fingerprint, err := CreateFingerprintV1(request)
	if err != nil {
		return SessionRecordV1{}, SessionSecretsV1{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record, secrets, err := s.loadLocked(request.SessionID)
	if err == nil {
		if record.CreateFingerprint != fingerprint {
			return SessionRecordV1{}, SessionSecretsV1{}, false, ErrSessionIDReuseV1
		}
		if record.State != "active" || record.Stopping || secrets == nil {
			return SessionRecordV1{}, SessionSecretsV1{}, false, ErrSessionTerminalV1
		}
		return cloneSessionRecordV1(record), cloneSessionSecretsV1(*secrets), true, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return SessionRecordV1{}, SessionSecretsV1{}, false, err
	}
	grant := response.Runtime.Grants[0]
	record = SessionRecordV1{
		Version: sessionRecordVersionV1, BrokerSessionID: request.SessionID,
		RunnerSessionID: response.RunnerSessionID, CreateFingerprint: fingerprint,
		State: "active", RuntimePublic: response.Runtime.Public,
		GrantAudit:    GrantAuditV1{ID: grant.ID, Operations: append([]string(nil), grant.Operations...), SecretSHA256: secretSHA256V1(grant.Secret), ExpiresAt: grant.ExpiresAt},
		PendingEvents: []RunnerEventV1{},
	}
	secretState := SessionSecretsV1{CreateRequest: request, CreateResponse: response, KeyIssues: map[string]StoredKeyIssueV1{}}
	if err := s.sealLocked(&record, secretState); err != nil {
		return SessionRecordV1{}, SessionSecretsV1{}, false, err
	}
	if err := s.saveLocked(record); err != nil {
		return SessionRecordV1{}, SessionSecretsV1{}, false, err
	}
	return cloneSessionRecordV1(record), cloneSessionSecretsV1(secretState), false, nil
}

func (s *EncryptedFileSessionStoreV1) Load(brokerSessionID string) (SessionRecordV1, *SessionSecretsV1, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, secrets, err := s.loadLocked(brokerSessionID)
	if err != nil {
		return SessionRecordV1{}, nil, err
	}
	copy := cloneSessionRecordV1(record)
	if secrets == nil {
		return copy, nil, nil
	}
	secretCopy := cloneSessionSecretsV1(*secrets)
	return copy, &secretCopy, nil
}

func (s *EncryptedFileSessionStoreV1) RecordKeyIssue(brokerSessionID string, request StreamKeyIssueRequestV1, response StreamKeyIssueResponseV1) (StreamKeyIssueResponseV1, bool, error) {
	if err := ValidateStreamKeyIssueRequestV1(request); err != nil {
		return StreamKeyIssueResponseV1{}, false, err
	}
	if err := ValidateStreamKeyIssueResponseV1(request, response); err != nil {
		return StreamKeyIssueResponseV1{}, false, err
	}
	fingerprint, err := KeyIssueFingerprintV1(request)
	if err != nil {
		return StreamKeyIssueResponseV1{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record, secrets, err := s.loadLocked(brokerSessionID)
	if err != nil {
		return StreamKeyIssueResponseV1{}, false, err
	}
	if record.State != "active" || record.Stopping || secrets == nil {
		return StreamKeyIssueResponseV1{}, false, ErrSessionTerminalV1
	}
	if stored, ok := secrets.KeyIssues[request.RequestID]; ok {
		if stored.Fingerprint != fingerprint {
			return StreamKeyIssueResponseV1{}, false, ErrRequestIDReuseV1
		}
		if secrets.CurrentKeyID != request.RequestID {
			return StreamKeyIssueResponseV1{}, false, ErrRequestSupersededV1
		}
		return stored.Response, true, nil
	}
	for id, stored := range secrets.KeyIssues {
		stored.Response.StreamKey = ""
		secrets.KeyIssues[id] = stored
	}
	secrets.KeyIssues[request.RequestID] = StoredKeyIssueV1{Fingerprint: fingerprint, Request: request, Response: response}
	secrets.CurrentKeyID = request.RequestID
	if err := s.sealLocked(&record, *secrets); err != nil {
		return StreamKeyIssueResponseV1{}, false, err
	}
	if err := s.saveLocked(record); err != nil {
		return StreamKeyIssueResponseV1{}, false, err
	}
	return response, false, nil
}

func (s *EncryptedFileSessionStoreV1) Advance(brokerSessionID string, event RunnerEventV1) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, _, err := s.loadLocked(brokerSessionID)
	if err != nil {
		return err
	}
	if record.State != "active" || (record.Stopping && event.State == "active") {
		return ErrSessionTerminalV1
	}
	if record.Stopping && (event.CloseReason == nil || *event.CloseReason != record.PendingCloseReason) {
		return errors.New("terminal event does not match durable close reason")
	}
	if event.EventID != record.RunnerSessionID+":"+strconv.FormatUint(event.Sequence, 10) {
		return errors.New("event ID must be derived from runner session ID and sequence")
	}
	cursor := EventCursorV1{Sequence: record.LastSequence, UsageTotal: record.UsageTotal, HasUsage: record.LastSequence > 0, SeenIDs: make(map[string]struct{})}
	for _, pending := range record.PendingEvents {
		cursor.SeenIDs[pending.EventID] = struct{}{}
	}
	if err := cursor.Accept(event); err != nil {
		return err
	}
	record.LastSequence = cursor.Sequence
	record.UsageTotal = cursor.UsageTotal
	record.PendingEvents = append(record.PendingEvents, event)
	if event.State == "ended" || event.State == "failed" {
		record.State = event.State
		record.CloseReason = *event.CloseReason
		record.Stopping = false
		record.PendingCloseReason = ""
	}
	return s.saveLocked(record)
}

func (s *EncryptedFileSessionStoreV1) BeginTermination(brokerSessionID, reason string) (SessionRecordV1, bool, error) {
	if !validCloseReasonV1(reason) {
		return SessionRecordV1{}, false, errors.New("termination reason is invalid")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record, _, err := s.loadLocked(brokerSessionID)
	if err != nil {
		return SessionRecordV1{}, false, err
	}
	if record.State != "active" {
		return cloneSessionRecordV1(record), false, nil
	}
	if record.Stopping {
		return cloneSessionRecordV1(record), false, nil
	}
	record.Stopping = true
	record.PendingCloseReason = reason
	if err := s.saveLocked(record); err != nil {
		return SessionRecordV1{}, false, err
	}
	return cloneSessionRecordV1(record), true, nil
}

func (s *EncryptedFileSessionStoreV1) AcknowledgeEvent(brokerSessionID, eventID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, _, err := s.loadLocked(brokerSessionID)
	if err != nil {
		return err
	}
	if len(record.PendingEvents) == 0 || record.PendingEvents[0].EventID != eventID {
		return errors.New("event acknowledgement is out of order")
	}
	record.PendingEvents = append([]RunnerEventV1(nil), record.PendingEvents[1:]...)
	return s.saveLocked(record)
}

func (s *EncryptedFileSessionStoreV1) ClearTerminalSecrets(brokerSessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, _, err := s.loadLocked(brokerSessionID)
	if err != nil {
		return err
	}
	if record.State == "active" || len(record.PendingEvents) != 0 {
		return errors.New("terminal secrets cannot be cleared before final event acknowledgement")
	}
	record.WrappedKeyNonce = ""
	record.WrappedKeyCiphertext = ""
	record.SecretNonce = ""
	record.SecretCiphertext = ""
	return s.saveLocked(record)
}

func (s *EncryptedFileSessionStoreV1) Recoverable() ([]SessionRecordV1, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	var records []SessionRecordV1
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		id := stringsTrimSuffixV1(entry.Name(), ".json")
		record, _, err := s.loadLocked(id)
		if err != nil {
			return nil, err
		}
		if record.State == "active" || len(record.PendingEvents) != 0 {
			records = append(records, cloneSessionRecordV1(record))
		}
	}
	sort.Slice(records, func(i, j int) bool { return records[i].BrokerSessionID < records[j].BrokerSessionID })
	return records, nil
}

func (s *EncryptedFileSessionStoreV1) LoadByRunnerSessionID(runnerSessionID string) (SessionRecordV1, *SessionSecretsV1, error) {
	if !opaqueIDPattern.MatchString(runnerSessionID) {
		return SessionRecordV1{}, nil, errors.New("invalid runner session ID")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return SessionRecordV1{}, nil, err
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		id := stringsTrimSuffixV1(entry.Name(), ".json")
		record, secrets, err := s.loadLocked(id)
		if err != nil {
			return SessionRecordV1{}, nil, err
		}
		if record.RunnerSessionID == runnerSessionID {
			copy := cloneSessionRecordV1(record)
			if secrets == nil {
				return copy, nil, nil
			}
			secretCopy := cloneSessionSecretsV1(*secrets)
			return copy, &secretCopy, nil
		}
	}
	return SessionRecordV1{}, nil, os.ErrNotExist
}

func (s *EncryptedFileSessionStoreV1) loadLocked(id string) (SessionRecordV1, *SessionSecretsV1, error) {
	if !opaqueIDPattern.MatchString(id) {
		return SessionRecordV1{}, nil, errors.New("invalid broker session ID")
	}
	body, err := os.ReadFile(s.path(id))
	if err != nil {
		return SessionRecordV1{}, nil, err
	}
	var record SessionRecordV1
	if err := decodeStrictBytesV1(body, &record); err != nil {
		return SessionRecordV1{}, nil, fmt.Errorf("decode session record: %w", err)
	}
	if err := s.verifyIntegrityV1(record); err != nil {
		return SessionRecordV1{}, nil, err
	}
	if err := validateSessionRecordV1(record, id); err != nil {
		return SessionRecordV1{}, nil, err
	}
	if record.WrappedKeyCiphertext == "" {
		return record, nil, nil
	}
	wrappedKeyNonce, err := hex.DecodeString(record.WrappedKeyNonce)
	if err != nil || len(wrappedKeyNonce) != s.aead.NonceSize() {
		return SessionRecordV1{}, nil, errors.New("session wrapped-key nonce is invalid")
	}
	wrappedKeyCiphertext, err := hex.DecodeString(record.WrappedKeyCiphertext)
	if err != nil {
		return SessionRecordV1{}, nil, errors.New("session wrapped-key ciphertext is invalid")
	}
	dataKey, err := s.aead.Open(nil, wrappedKeyNonce, wrappedKeyCiphertext, []byte(id+":dek"))
	if err != nil || len(dataKey) != 32 {
		return SessionRecordV1{}, nil, errors.New("session data-key decryption failed")
	}
	secretAEAD, err := newAESGCMV1(dataKey)
	if err != nil {
		return SessionRecordV1{}, nil, errors.New("session data key is invalid")
	}
	nonce, err := hex.DecodeString(record.SecretNonce)
	if err != nil || len(nonce) != secretAEAD.NonceSize() {
		return SessionRecordV1{}, nil, errors.New("session secret nonce is invalid")
	}
	ciphertext, err := hex.DecodeString(record.SecretCiphertext)
	if err != nil {
		return SessionRecordV1{}, nil, errors.New("session secret ciphertext is invalid")
	}
	plaintext, err := secretAEAD.Open(nil, nonce, ciphertext, []byte(id+":secrets"))
	if err != nil {
		return SessionRecordV1{}, nil, errors.New("session secret decryption failed")
	}
	var secrets SessionSecretsV1
	if err := decodeStrictBytesV1(plaintext, &secrets); err != nil {
		return SessionRecordV1{}, nil, errors.New("session secret payload is invalid")
	}
	if secrets.CreateRequest.SessionID != id || secrets.CreateResponse.RunnerSessionID != record.RunnerSessionID {
		return SessionRecordV1{}, nil, errors.New("session secret identity mismatch")
	}
	if err := validateSessionSecretsV1(record, secrets); err != nil {
		return SessionRecordV1{}, nil, err
	}
	return record, &secrets, nil
}

func (s *EncryptedFileSessionStoreV1) sealLocked(record *SessionRecordV1, secrets SessionSecretsV1) error {
	body, err := json.Marshal(secrets)
	if err != nil {
		return err
	}
	dataKey := make([]byte, 32)
	if _, err := rand.Read(dataKey); err != nil {
		return err
	}
	secretAEAD, err := newAESGCMV1(dataKey)
	if err != nil {
		return err
	}
	wrappedKeyNonce := make([]byte, s.aead.NonceSize())
	if _, err := rand.Read(wrappedKeyNonce); err != nil {
		return err
	}
	wrappedKeyCiphertext := s.aead.Seal(nil, wrappedKeyNonce, dataKey, []byte(record.BrokerSessionID+":dek"))
	nonce := make([]byte, secretAEAD.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	ciphertext := secretAEAD.Seal(nil, nonce, body, []byte(record.BrokerSessionID+":secrets"))
	record.WrappedKeyNonce = hex.EncodeToString(wrappedKeyNonce)
	record.WrappedKeyCiphertext = hex.EncodeToString(wrappedKeyCiphertext)
	record.SecretNonce = hex.EncodeToString(nonce)
	record.SecretCiphertext = hex.EncodeToString(ciphertext)
	return nil
}

func (s *EncryptedFileSessionStoreV1) saveLocked(record SessionRecordV1) error {
	integrity, err := s.integrityV1(record)
	if err != nil {
		return err
	}
	record.IntegritySHA256 = integrity
	temporary, err := os.CreateTemp(s.dir, ".session-*.tmp")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if err := json.NewEncoder(temporary).Encode(record); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(name, s.path(record.BrokerSessionID)); err != nil {
		return err
	}
	directory, err := os.Open(s.dir)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func (s *EncryptedFileSessionStoreV1) path(id string) string { return filepath.Join(s.dir, id+".json") }

func (s *EncryptedFileSessionStoreV1) integrityV1(record SessionRecordV1) (string, error) {
	record.IntegritySHA256 = ""
	body, err := json.Marshal(record)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, s.key)
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func (s *EncryptedFileSessionStoreV1) verifyIntegrityV1(record SessionRecordV1) error {
	if !workIDPattern.MatchString(record.IntegritySHA256) {
		return errors.New("session record integrity is invalid")
	}
	expected, err := s.integrityV1(record)
	if err != nil || !hmac.Equal([]byte(expected), []byte(record.IntegritySHA256)) {
		return errors.New("session record integrity check failed")
	}
	return nil
}

func validateSessionRecordV1(record SessionRecordV1, id string) error {
	if record.Version != sessionRecordVersionV1 || record.BrokerSessionID != id || !opaqueIDPattern.MatchString(record.RunnerSessionID) || !workIDPattern.MatchString(record.CreateFingerprint) || !validStateV1(record.State) {
		return errors.New("session record identity is invalid")
	}
	secretFields := []string{record.WrappedKeyNonce, record.WrappedKeyCiphertext, record.SecretNonce, record.SecretCiphertext}
	hasSecrets := secretFields[0] != ""
	for _, field := range secretFields[1:] {
		if (field != "") != hasSecrets {
			return errors.New("session record secret envelope is incomplete")
		}
	}
	if record.State == "active" && !hasSecrets {
		return errors.New("session record secret envelope is incomplete")
	}
	if !workIDPattern.MatchString(record.GrantAudit.SecretSHA256) || !opaqueIDPattern.MatchString(record.GrantAudit.ID) || len(record.GrantAudit.Operations) != 1 || record.GrantAudit.Operations[0] != GrantOperationV1 {
		return errors.New("session record grant audit is invalid")
	}
	if _, err := time.Parse(time.RFC3339, record.GrantAudit.ExpiresAt); err != nil {
		return errors.New("session record grant expiry is invalid")
	}
	if err := validateURLScheme(record.RuntimePublic.RTMPURL, "rtmp", "rtmps"); err != nil {
		return errors.New("session record RTMP coordinate is invalid")
	}
	if err := validateHTTPURL(record.RuntimePublic.HLSURL); err != nil {
		return errors.New("session record HLS coordinate is invalid")
	}
	if err := validateHTTPURL(record.RuntimePublic.KeyIssueURL); err != nil {
		return errors.New("session record key issuance coordinate is invalid")
	}
	terminal := record.State == "ended" || record.State == "failed"
	if terminal != (record.CloseReason != "") || (record.CloseReason != "" && !validCloseReasonV1(record.CloseReason)) {
		return errors.New("session record terminal state is invalid")
	}
	if record.Stopping != (record.PendingCloseReason != "") || (record.PendingCloseReason != "" && !validCloseReasonV1(record.PendingCloseReason)) || terminal && record.Stopping {
		return errors.New("session record stopping state is invalid")
	}
	var previousSequence uint64
	var previousUsage uint64
	var hasUsage bool
	for _, event := range record.PendingEvents {
		if err := ValidateEventV1(event); err != nil || event.EventID != record.RunnerSessionID+":"+strconv.FormatUint(event.Sequence, 10) || event.Sequence <= previousSequence || event.Sequence > record.LastSequence {
			return errors.New("session record event outbox is invalid")
		}
		if event.Usage != nil && hasUsage && event.Usage.Total < previousUsage {
			return errors.New("session record event outbox usage is invalid")
		}
		previousSequence = event.Sequence
		if event.Usage != nil {
			previousUsage = event.Usage.Total
			hasUsage = true
		}
	}
	if record.UsageTotal > 0 && record.LastSequence == 0 {
		return errors.New("session record usage cursor is invalid")
	}
	if len(record.PendingEvents) > 0 {
		last := record.PendingEvents[len(record.PendingEvents)-1]
		if last.Sequence != record.LastSequence || (last.Usage != nil && last.Usage.Total != record.UsageTotal) {
			return errors.New("session record event cursor is inconsistent")
		}
	}
	return nil
}

func validateSessionSecretsV1(record SessionRecordV1, secrets SessionSecretsV1) error {
	if err := ValidateCreateRequestV1(secrets.CreateRequest); err != nil {
		return errors.New("session secret create request is invalid")
	}
	if err := ValidateCreateResponseV1(secrets.CreateResponse); err != nil {
		return errors.New("session secret create response is invalid")
	}
	fingerprint, err := CreateFingerprintV1(secrets.CreateRequest)
	if err != nil || fingerprint != record.CreateFingerprint || secrets.CreateRequest.SessionID != record.BrokerSessionID || secrets.CreateResponse.RunnerSessionID != record.RunnerSessionID || !reflect.DeepEqual(secrets.CreateResponse.Runtime.Public, record.RuntimePublic) {
		return errors.New("session secret create identity is invalid")
	}
	grant := secrets.CreateResponse.Runtime.Grants[0]
	if grant.ID != record.GrantAudit.ID || !reflect.DeepEqual(grant.Operations, record.GrantAudit.Operations) || grant.ExpiresAt != record.GrantAudit.ExpiresAt || secretSHA256V1(grant.Secret) != record.GrantAudit.SecretSHA256 {
		return errors.New("session secret grant identity is invalid")
	}
	if secrets.CurrentKeyID != "" {
		if _, ok := secrets.KeyIssues[secrets.CurrentKeyID]; !ok {
			return errors.New("session current stream key is missing")
		}
	}
	for id, issue := range secrets.KeyIssues {
		fingerprint, err := KeyIssueFingerprintV1(issue.Request)
		if err != nil || id != issue.Request.RequestID || fingerprint != issue.Fingerprint {
			return errors.New("session key issue identity is invalid")
		}
		if id == secrets.CurrentKeyID {
			if err := ValidateStreamKeyIssueResponseV1(issue.Request, issue.Response); err != nil {
				return errors.New("session current key response is invalid")
			}
		} else if issue.Response.RequestID != id || issue.Response.StreamKey != "" {
			return errors.New("session superseded key response is invalid")
		}
	}
	return nil
}

func newAESGCMV1(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func deriveKeyV1(master []byte, label string) []byte {
	mac := hmac.New(sha256.New, master)
	_, _ = mac.Write([]byte(label))
	return mac.Sum(nil)
}

func decodeStrictBytesV1(body []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON")
	}
	return nil
}

func secretSHA256V1(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func cloneSessionRecordV1(value SessionRecordV1) SessionRecordV1 {
	body, _ := json.Marshal(value)
	var clone SessionRecordV1
	_ = json.Unmarshal(body, &clone)
	return clone
}

func cloneSessionSecretsV1(value SessionSecretsV1) SessionSecretsV1 {
	body, _ := json.Marshal(value)
	var clone SessionSecretsV1
	_ = json.Unmarshal(body, &clone)
	return clone
}

func stringsTrimSuffixV1(value, suffix string) string {
	if len(value) >= len(suffix) && value[len(value)-len(suffix):] == suffix {
		return value[:len(value)-len(suffix)]
	}
	return value
}
