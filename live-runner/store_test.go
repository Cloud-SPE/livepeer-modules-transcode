package liverunner

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestEncryptedStoreCreateReplayAndRestart(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte{0x2a}, 32)
	store := newTestStoreV1(t, dir, key)
	request, response := testCreatePairV1(t)

	record, secrets, replay, err := store.CreateOrReplay(request, response)
	if err != nil || replay {
		t.Fatalf("create replay=%v err=%v", replay, err)
	}
	if record.BrokerSessionID != request.SessionID || secrets.CreateRequest.CallbackToken != request.CallbackToken {
		t.Fatal("created state does not preserve session identity and private callback state")
	}
	statePath := filepath.Join(dir, request.SessionID+".json")
	info, err := os.Stat(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("state mode=%v", info.Mode().Perm())
	}
	onDisk, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"callback-secret-fixture", "grant-secret-fixture", "sts-secret-fixture", "sts-session-token-fixture"} {
		if bytes.Contains(onDisk, []byte(secret)) {
			t.Fatalf("state file contains plaintext secret %q", secret)
		}
	}

	restarted := newTestStoreV1(t, dir, key)
	replayedRecord, replayedSecrets, replay, err := restarted.CreateOrReplay(request, response)
	if err != nil || !replay || replayedRecord.RunnerSessionID != record.RunnerSessionID || replayedSecrets.CreateResponse.Runtime.Grants[0].Secret != "grant-secret-fixture" {
		t.Fatalf("restart replay=%v record=%+v err=%v", replay, replayedRecord, err)
	}
	changed := request
	changed.CallbackToken = "changed"
	if _, _, _, err := restarted.CreateOrReplay(changed, response); !errors.Is(err, ErrSessionIDReuseV1) {
		t.Fatalf("changed create error=%v", err)
	}
	wrongKey := newTestStoreV1(t, dir, bytes.Repeat([]byte{0x3b}, 32))
	if _, _, err := wrongKey.Load(request.SessionID); err == nil {
		t.Fatal("wrong master key decrypted session state")
	}
}

func TestEncryptedStoreKeyRotationIsIdempotentAndSupersedesOldRequests(t *testing.T) {
	store := newTestStoreV1(t, t.TempDir(), bytes.Repeat([]byte{0x4c}, 32))
	request, response := testCreatePairV1(t)
	if _, _, _, err := store.CreateOrReplay(request, response); err != nil {
		t.Fatal(err)
	}
	issue := readStrictFixtureV1[StreamKeyIssueRequestV1](t, "key-issue-request.json")
	issued := readStrictFixtureV1[StreamKeyIssueResponseV1](t, "key-issue-response.json")
	got, replay, err := store.RecordKeyIssue(request.SessionID, issue, issued)
	if err != nil || replay || got.StreamKey != issued.StreamKey {
		t.Fatalf("first issue replay=%v response=%+v err=%v", replay, got, err)
	}
	got, replay, err = store.RecordKeyIssue(request.SessionID, issue, issued)
	if err != nil || !replay || got != issued {
		t.Fatalf("issue replay=%v response=%+v err=%v", replay, got, err)
	}
	changed := issue
	changed.Audience = "direct-publisher"
	if _, _, err := store.RecordKeyIssue(request.SessionID, changed, issued); !errors.Is(err, ErrRequestIDReuseV1) {
		t.Fatalf("changed issue error=%v", err)
	}
	rotatedRequest := StreamKeyIssueRequestV1{RequestID: "key_issue_002", Audience: issue.Audience}
	rotatedResponse := StreamKeyIssueResponseV1{RequestID: rotatedRequest.RequestID, StreamKey: "rotated-stream-key", ExpiresAt: "2030-01-01T00:00:00Z"}
	if _, replay, err := store.RecordKeyIssue(request.SessionID, rotatedRequest, rotatedResponse); err != nil || replay {
		t.Fatalf("rotation replay=%v err=%v", replay, err)
	}
	if _, _, err := store.RecordKeyIssue(request.SessionID, issue, issued); !errors.Is(err, ErrRequestSupersededV1) {
		t.Fatalf("superseded issue error=%v", err)
	}
	_, secrets, err := store.Load(request.SessionID)
	if err != nil || secrets == nil || secrets.KeyIssues[issue.RequestID].Response.StreamKey != "" || secrets.KeyIssues[rotatedRequest.RequestID].Response.StreamKey != rotatedResponse.StreamKey {
		t.Fatalf("rotated credential retention=%+v err=%v", secrets, err)
	}
}

func TestEncryptedStoreEventOutboxRecoveryAndCryptoErase(t *testing.T) {
	dir := t.TempDir()
	key := bytes.Repeat([]byte{0x5d}, 32)
	store := newTestStoreV1(t, dir, key)
	request, response := testCreatePairV1(t)
	if _, _, _, err := store.CreateOrReplay(request, response); err != nil {
		t.Fatal(err)
	}
	started := testEventV1(response.RunnerSessionID, 1, "session.started", "active", 0, "")
	if err := store.Advance(request.SessionID, started); err != nil {
		t.Fatal(err)
	}
	if err := store.Advance(request.SessionID, started); err == nil {
		t.Fatal("duplicate event was accepted")
	}
	if err := store.AcknowledgeEvent(request.SessionID, "wrong"); err == nil {
		t.Fatal("out-of-order acknowledgement was accepted")
	}

	restarted := newTestStoreV1(t, dir, key)
	recoverable, err := restarted.Recoverable()
	if err != nil || len(recoverable) != 1 || len(recoverable[0].PendingEvents) != 1 {
		t.Fatalf("recoverable=%+v err=%v", recoverable, err)
	}
	if err := restarted.AcknowledgeEvent(request.SessionID, started.EventID); err != nil {
		t.Fatal(err)
	}
	ended := testEventV1(response.RunnerSessionID, 2, "session.ended", "ended", 17, "gateway_close")
	if err := restarted.Advance(request.SessionID, ended); err != nil {
		t.Fatal(err)
	}
	if err := restarted.ClearTerminalSecrets(request.SessionID); err == nil {
		t.Fatal("terminal secrets cleared before final callback acknowledgement")
	}
	if err := restarted.AcknowledgeEvent(request.SessionID, ended.EventID); err != nil {
		t.Fatal(err)
	}
	if err := restarted.ClearTerminalSecrets(request.SessionID); err != nil {
		t.Fatal(err)
	}
	record, secrets, err := restarted.Load(request.SessionID)
	if err != nil || secrets != nil || record.State != "ended" || record.UsageTotal != 17 {
		t.Fatalf("terminal state=%+v secrets=%+v err=%v", record, secrets, err)
	}
	if record.WrappedKeyCiphertext != "" || record.SecretCiphertext != "" {
		t.Fatal("terminal state retained a decryptable secret envelope")
	}
	recoverable, err = restarted.Recoverable()
	if err != nil || len(recoverable) != 0 {
		t.Fatalf("cleared terminal session remained recoverable: %+v err=%v", recoverable, err)
	}
}

func TestEncryptedStoreRejectsTamperedState(t *testing.T) {
	dir := t.TempDir()
	store := newTestStoreV1(t, dir, bytes.Repeat([]byte{0x6e}, 32))
	request, response := testCreatePairV1(t)
	if _, _, _, err := store.CreateOrReplay(request, response); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, request.SessionID+".json")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var record SessionRecordV1
	if err := json.Unmarshal(body, &record); err != nil {
		t.Fatal(err)
	}
	if record.SecretCiphertext[0] == '0' {
		record.SecretCiphertext = "1" + record.SecretCiphertext[1:]
	} else {
		record.SecretCiphertext = "0" + record.SecretCiphertext[1:]
	}
	body, err = json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Load(request.SessionID); err == nil {
		t.Fatal("tampered ciphertext was accepted")
	}
}

func TestEncryptedStoreRejectsTamperedPublicMetadata(t *testing.T) {
	dir := t.TempDir()
	store := newTestStoreV1(t, dir, bytes.Repeat([]byte{0x6f}, 32))
	request, response := testCreatePairV1(t)
	if _, _, _, err := store.CreateOrReplay(request, response); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, request.SessionID+".json")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var record SessionRecordV1
	if err := json.Unmarshal(body, &record); err != nil {
		t.Fatal(err)
	}
	record.RuntimePublic.HLSURL = "https://attacker.example/master.m3u8"
	body, err = json.Marshal(record)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Load(request.SessionID); err == nil {
		t.Fatal("tampered public metadata was accepted")
	}
}

func TestEncryptedStoreRequiresDeterministicEventIDs(t *testing.T) {
	store := newTestStoreV1(t, t.TempDir(), bytes.Repeat([]byte{0x7f}, 32))
	request, response := testCreatePairV1(t)
	if _, _, _, err := store.CreateOrReplay(request, response); err != nil {
		t.Fatal(err)
	}
	event := testEventV1(response.RunnerSessionID, 1, "session.started", "active", 0, "")
	event.EventID = "arbitrary_event_id"
	if err := store.Advance(request.SessionID, event); err == nil {
		t.Fatal("non-deterministic event ID was accepted")
	}
}

func newTestStoreV1(t *testing.T, dir string, key []byte) *EncryptedFileSessionStoreV1 {
	t.Helper()
	store, err := NewEncryptedFileSessionStoreV1(dir, key)
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func testCreatePairV1(t *testing.T) (RunnerCreateRequestV1, RunnerCreateResponseV1) {
	t.Helper()
	return readStrictFixtureV1[RunnerCreateRequestV1](t, "create-request.json"), readStrictFixtureV1[RunnerCreateResponseV1](t, "create-response.json")
}

func testEventV1(runnerSessionID string, sequence uint64, eventType, state string, total uint64, closeReason string) RunnerEventV1 {
	event := RunnerEventV1{
		EventID: runnerSessionID + ":" + strconv.FormatUint(sequence, 10), Sequence: sequence,
		EventType: eventType, EventTime: time.Date(2026, 8, 23, 12, 0, int(sequence), 0, time.UTC).Format(time.RFC3339Nano),
		State: state, Details: json.RawMessage(`{}`),
	}
	if eventType == "session.usage.tick" || eventType == "session.ended" || eventType == "session.failed" {
		event.Usage = &UsageV1{Unit: WorkUnitV1, Total: total}
	}
	if closeReason != "" {
		event.CloseReason = &closeReason
	}
	return event
}
