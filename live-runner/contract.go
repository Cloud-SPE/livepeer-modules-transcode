package liverunner

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/bits"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const (
	PaidSessionProtocolV1 = "paid-session/v1"
	RuntimeSchemaV1       = "rtmp-hls/v1"
	SessionParamsSchemaV1 = "rtmp-hls-session/v1"
	WorkUnitV1            = "output_seconds"
	GrantOperationV1      = "stream-key-issue"
)

var (
	opaqueIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
	workIDPattern   = regexp.MustCompile(`^[0-9a-f]{64}$`)
	closeReasonsV1  = map[string]struct{}{
		"gateway_close": {}, "lease_expired": {}, "heartbeat_lost": {},
		"runway_exhausted": {}, "refill_refused": {}, "recovery_failed": {},
		"payment_unrecoverable": {}, "runner_failed": {}, "ingest_failed": {},
		"output_failed": {},
	}
)

type RunnerCreateRequestV1 struct {
	SessionID     string                 `json:"session_id"`
	WorkID        string                 `json:"work_id"`
	Capability    string                 `json:"capability"`
	Offering      string                 `json:"offering"`
	SessionParams RTMPHLSSessionParamsV1 `json:"session_params"`
	CallbackURL   string                 `json:"callback_url"`
	CallbackToken string                 `json:"callback_token"`
}

type RTMPHLSSessionParamsV1 struct {
	Schema            string    `json:"schema"`
	PublisherMode     string    `json:"publisher_mode"`
	OutputProfile     string    `json:"output_profile"`
	MeteringRendition string    `json:"metering_rendition"`
	Storage           StorageV1 `json:"storage"`
}

type StorageV1 struct {
	Kind string              `json:"kind"`
	S3   *S3SessionStorageV1 `json:"s3,omitempty"`
}

type S3SessionStorageV1 struct {
	Endpoint        string `json:"endpoint"`
	Region          string `json:"region"`
	Bucket          string `json:"bucket"`
	Prefix          string `json:"prefix"`
	AccessKeyID     string `json:"access_key_id"`
	SecretAccessKey string `json:"secret_access_key"`
	SessionToken    string `json:"session_token"`
	ForcePathStyle  bool   `json:"force_path_style,omitempty"`
}

type RunnerCreateResponseV1 struct {
	RunnerSessionID string              `json:"runner_session_id"`
	Runtime         RuntimeDescriptorV1 `json:"runtime"`
}

type RuntimeDescriptorV1 struct {
	Schema string          `json:"schema"`
	Public RuntimePublicV1 `json:"public"`
	Grants []GrantV1       `json:"grants"`
}

type RuntimePublicV1 struct {
	RTMPURL     string `json:"rtmp_url"`
	HLSURL      string `json:"hls_url"`
	KeyIssueURL string `json:"key_issue_url"`
	StatusURL   string `json:"status_url,omitempty"`
}

type GrantV1 struct {
	ID         string   `json:"id"`
	Operations []string `json:"operations"`
	Secret     string   `json:"secret"`
	ExpiresAt  string   `json:"expires_at"`
}

type RunnerStatusV1 struct {
	RunnerSessionID string  `json:"runner_session_id"`
	State           string  `json:"state"`
	Usage           UsageV1 `json:"usage"`
	LastSequence    uint64  `json:"last_sequence"`
	CloseReason     string  `json:"close_reason,omitempty"`
}

type UsageV1 struct {
	Unit  string `json:"unit"`
	Total uint64 `json:"total"`
}

type RunnerEventV1 struct {
	EventID     string          `json:"event_id"`
	Sequence    uint64          `json:"sequence"`
	EventType   string          `json:"event_type"`
	EventTime   string          `json:"event_time"`
	State       string          `json:"state"`
	Usage       *UsageV1        `json:"usage,omitempty"`
	CloseReason *string         `json:"close_reason"`
	Details     json.RawMessage `json:"details"`
}

type EventCursorV1 struct {
	Sequence   uint64
	UsageTotal uint64
	HasUsage   bool
	SeenIDs    map[string]struct{}
}

type StreamKeyIssueRequestV1 struct {
	RequestID string `json:"request_id"`
	Audience  string `json:"audience"`
}

type StreamKeyIssueResponseV1 struct {
	RequestID string `json:"request_id"`
	StreamKey string `json:"stream_key"`
	ExpiresAt string `json:"expires_at"`
}

type ReplayDispositionV1 string

const (
	ReplayIdenticalV1 ReplayDispositionV1 = "replay_identical"
	RejectIDReuseV1   ReplayDispositionV1 = "reject_id_reuse"
)

type TerminateRequestV1 struct {
	Reason string `json:"reason"`
}
type TerminateResponseV1 struct {
	RunnerSessionID string `json:"runner_session_id"`
	State           string `json:"state"`
	CloseReason     string `json:"close_reason"`
}

type DescribeResponseV1 struct {
	Protocols    []string                `json:"protocols"`
	Capabilities []DescribedCapabilityV1 `json:"capabilities"`
}

type DescribedCapabilityV1 struct {
	CapabilityID        string          `json:"capability_id"`
	DescriptorSchemas   []string        `json:"descriptor_schemas"`
	WorkUnit            string          `json:"work_unit"`
	Metering            string          `json:"metering"`
	Heartbeat           HeartbeatV1     `json:"heartbeat"`
	Readiness           ReadinessV1     `json:"readiness"`
	SessionParamsSchema json.RawMessage `json:"session_params_schema"`
	Paths               RunnerPathsV1   `json:"paths"`
}

type HeartbeatV1 struct {
	IntervalSeconds uint32 `json:"interval_seconds"`
}
type ReadinessV1 struct {
	Path string `json:"path"`
}
type RunnerPathsV1 struct {
	Create    string `json:"create"`
	Status    string `json:"status"`
	Terminate string `json:"terminate"`
}

func ValidateCreateRequestV1(value RunnerCreateRequestV1) error {
	if !opaqueIDPattern.MatchString(value.SessionID) || !workIDPattern.MatchString(value.WorkID) {
		return errors.New("session or work identity is invalid")
	}
	if strings.TrimSpace(value.Capability) == "" || strings.TrimSpace(value.Offering) == "" {
		return errors.New("capability and offering are required")
	}
	if value.SessionParams.Schema != SessionParamsSchemaV1 || (value.SessionParams.PublisherMode != "gateway-relay" && value.SessionParams.PublisherMode != "direct-publisher") {
		return errors.New("session parameter schema or publisher mode is invalid")
	}
	if !opaqueIDPattern.MatchString(value.SessionParams.OutputProfile) || !opaqueIDPattern.MatchString(value.SessionParams.MeteringRendition) {
		return errors.New("output profile or metering rendition is invalid")
	}
	if err := validateStorageV1(value.SessionParams.Storage); err != nil {
		return err
	}
	if err := validateHTTPURL(value.CallbackURL); err != nil || value.CallbackToken == "" {
		return errors.New("callback coordinates are invalid")
	}
	return nil
}

func ValidateCreateResponseV1(value RunnerCreateResponseV1) error {
	if !opaqueIDPattern.MatchString(value.RunnerSessionID) || value.Runtime.Schema != RuntimeSchemaV1 {
		return errors.New("runner session or runtime schema is invalid")
	}
	if err := validateURLScheme(value.Runtime.Public.RTMPURL, "rtmp", "rtmps"); err != nil {
		return fmt.Errorf("rtmp_url: %w", err)
	}
	for name, raw := range map[string]string{"hls_url": value.Runtime.Public.HLSURL, "key_issue_url": value.Runtime.Public.KeyIssueURL} {
		if err := validateHTTPURL(raw); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	if value.Runtime.Public.StatusURL != "" {
		if err := validateHTTPURL(value.Runtime.Public.StatusURL); err != nil {
			return err
		}
	}
	if len(value.Runtime.Grants) != 1 {
		return errors.New("rtmp-hls requires exactly one grant")
	}
	grant := value.Runtime.Grants[0]
	if !opaqueIDPattern.MatchString(grant.ID) || len(grant.Operations) != 1 || grant.Operations[0] != GrantOperationV1 || grant.Secret == "" {
		return errors.New("stream-key-issue grant is invalid")
	}
	if _, err := time.Parse(time.RFC3339, grant.ExpiresAt); err != nil {
		return errors.New("grant expiry is invalid")
	}
	return nil
}

func ValidateStatusV1(value RunnerStatusV1) error {
	if !opaqueIDPattern.MatchString(value.RunnerSessionID) || !validStateV1(value.State) || value.Usage.Unit != WorkUnitV1 {
		return errors.New("runner status is invalid")
	}
	if (value.State == "ended" || value.State == "failed") != (value.CloseReason != "") {
		return errors.New("terminal status requires a close reason")
	}
	if value.CloseReason != "" && !validCloseReasonV1(value.CloseReason) {
		return errors.New("terminal status close reason is invalid")
	}
	return nil
}

func ValidateEventV1(value RunnerEventV1) error {
	if !opaqueIDPattern.MatchString(value.EventID) || value.Sequence == 0 {
		return errors.New("event identity is invalid")
	}
	if _, err := time.Parse(time.RFC3339Nano, value.EventTime); err != nil {
		return errors.New("event time is invalid")
	}
	if !validStateV1(value.State) {
		return errors.New("event state is invalid")
	}
	switch value.EventType {
	case "session.started", "session.heartbeat":
		if value.State != "active" {
			return errors.New("liveness event must be active")
		}
	case "session.usage.tick":
		if value.State != "active" || value.Usage == nil {
			return errors.New("usage event is invalid")
		}
	case "session.failed":
		if value.State != "failed" || value.Usage == nil || value.CloseReason == nil || !validCloseReasonV1(*value.CloseReason) {
			return errors.New("failed event is invalid")
		}
	case "session.ended":
		if value.State != "ended" || value.Usage == nil || value.CloseReason == nil || !validCloseReasonV1(*value.CloseReason) {
			return errors.New("ended event is invalid")
		}
	default:
		return errors.New("event type is invalid")
	}
	if value.Usage != nil && value.Usage.Unit != WorkUnitV1 {
		return errors.New("event work unit is invalid")
	}
	if len(value.Details) == 0 || !json.Valid(value.Details) {
		return errors.New("event details must be JSON")
	}
	return nil
}

func ValidateEventAdvanceV1(previous, next RunnerEventV1) error {
	if err := ValidateEventV1(next); err != nil {
		return err
	}
	if next.Sequence <= previous.Sequence || next.EventID == previous.EventID {
		return errors.New("event sequence did not advance")
	}
	if previous.Usage != nil && next.Usage != nil && next.Usage.Total < previous.Usage.Total {
		return errors.New("cumulative usage decreased")
	}
	return nil
}

func (cursor *EventCursorV1) Accept(event RunnerEventV1) error {
	if err := ValidateEventV1(event); err != nil {
		return err
	}
	if event.Sequence <= cursor.Sequence {
		return errors.New("event sequence did not advance")
	}
	if cursor.SeenIDs == nil {
		cursor.SeenIDs = make(map[string]struct{})
	}
	if _, duplicate := cursor.SeenIDs[event.EventID]; duplicate {
		return errors.New("event ID was reused")
	}
	if event.Usage != nil && cursor.HasUsage && event.Usage.Total < cursor.UsageTotal {
		return errors.New("cumulative usage decreased")
	}
	cursor.Sequence = event.Sequence
	cursor.SeenIDs[event.EventID] = struct{}{}
	if event.Usage != nil {
		cursor.UsageTotal = event.Usage.Total
		cursor.HasUsage = true
	}
	return nil
}

func ValidateStreamKeyIssueRequestV1(value StreamKeyIssueRequestV1) error {
	if !opaqueIDPattern.MatchString(value.RequestID) || (value.Audience != "gateway-relay" && value.Audience != "direct-publisher") {
		return errors.New("key issuance request is invalid")
	}
	return nil
}

func ValidateStreamKeyIssueResponseV1(request StreamKeyIssueRequestV1, response StreamKeyIssueResponseV1) error {
	if response.RequestID != request.RequestID || strings.TrimSpace(response.StreamKey) == "" || len(response.StreamKey) > 512 {
		return errors.New("key issuance response is invalid")
	}
	if _, err := time.Parse(time.RFC3339, response.ExpiresAt); err != nil {
		return errors.New("key expiry is invalid")
	}
	return nil
}

func ClassifyReplayV1(recordedFingerprint, incomingFingerprint string) ReplayDispositionV1 {
	if recordedFingerprint == incomingFingerprint {
		return ReplayIdenticalV1
	}
	return RejectIDReuseV1
}

func ValidateTerminateV1(request TerminateRequestV1, response TerminateResponseV1) error {
	if !validCloseReasonV1(request.Reason) || !opaqueIDPattern.MatchString(response.RunnerSessionID) || (response.State != "ended" && response.State != "failed") || !validCloseReasonV1(response.CloseReason) {
		return errors.New("termination contract is invalid")
	}
	return nil
}

func ValidateDescribeV1(value DescribeResponseV1) error {
	if len(value.Protocols) != 1 || value.Protocols[0] != PaidSessionProtocolV1 || len(value.Capabilities) != 1 {
		return errors.New("describe protocol or capability count is invalid")
	}
	capability := value.Capabilities[0]
	if capability.CapabilityID == "" || len(capability.DescriptorSchemas) != 1 || capability.DescriptorSchemas[0] != RuntimeSchemaV1 || capability.WorkUnit != WorkUnitV1 || capability.Metering != "runner-reported" || capability.Heartbeat.IntervalSeconds == 0 {
		return errors.New("described capability is invalid")
	}
	if capability.Readiness.Path != "/ready" || capability.Paths.Create == "" || !strings.Contains(capability.Paths.Status, "{id}") || !strings.Contains(capability.Paths.Terminate, "{id}") || !json.Valid(capability.SessionParamsSchema) {
		return errors.New("described runner paths or parameter schema is invalid")
	}
	return nil
}

// CalculateOutputSecondsV1 meters one named rendition's finalized segment
// timeline. It floors only after summing, so sub-second segments accumulate.
func CalculateOutputSecondsV1(segmentMicroseconds []uint64) (uint64, error) {
	var total uint64
	for _, duration := range segmentMicroseconds {
		var carry uint64
		total, carry = bits.Add64(total, duration, 0)
		if carry != 0 {
			return 0, errors.New("output timeline overflow")
		}
	}
	return total / 1_000_000, nil
}

func CustomerRuntimeV1(value RuntimePublicV1) struct {
	RTMPURL string `json:"rtmp_url"`
	HLSURL  string `json:"hls_url"`
} {
	return struct {
		RTMPURL string `json:"rtmp_url"`
		HLSURL  string `json:"hls_url"`
	}{RTMPURL: value.RTMPURL, HLSURL: value.HLSURL}
}

func CreateFingerprintV1(value RunnerCreateRequestV1) (string, error) { return canonicalHashV1(value) }
func KeyIssueFingerprintV1(value StreamKeyIssueRequestV1) (string, error) {
	return canonicalHashV1(value)
}

func DecodeStrictV1(reader io.Reader, value any) error {
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON")
	}
	return nil
}

func validateStorageV1(value StorageV1) error {
	switch value.Kind {
	case "runner-local":
		if value.S3 != nil {
			return errors.New("runner-local storage cannot include s3 credentials")
		}
	case "s3":
		if value.S3 == nil {
			return errors.New("s3 storage credentials are required")
		}
		s3 := value.S3
		if err := validateHTTPURL(s3.Endpoint); err != nil || s3.Region == "" || s3.Bucket == "" || s3.Prefix == "" || strings.Contains(s3.Prefix, "..") || strings.HasPrefix(s3.Prefix, "/") || strings.ContainsAny(s3.Prefix, "?\\\r\n") || s3.AccessKeyID == "" || s3.SecretAccessKey == "" || s3.SessionToken == "" {
			return errors.New("s3 session storage is invalid")
		}
	default:
		return errors.New("storage kind is invalid")
	}
	return nil
}

func validStateV1(value string) bool {
	return value == "active" || value == "ended" || value == "failed"
}
func validCloseReasonV1(value string) bool {
	_, ok := closeReasonsV1[value]
	return ok
}
func validateHTTPURL(raw string) error { return validateURLScheme(raw, "http", "https") }
func validateURLScheme(raw string, schemes ...string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return errors.New("URL is invalid")
	}
	for _, scheme := range schemes {
		if parsed.Scheme == scheme {
			return nil
		}
	}
	return errors.New("URL scheme is invalid")
}
func canonicalHashV1(value any) (string, error) {
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return "", err
	}
	sum := sha256.Sum256(bytes.TrimSuffix(body.Bytes(), []byte("\n")))
	return hex.EncodeToString(sum[:]), nil
}
