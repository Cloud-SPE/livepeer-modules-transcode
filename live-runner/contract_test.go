package liverunner

import (
	"bufio"
	"bytes"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestContractFixturesValidate(t *testing.T) {
	createRequest := readStrictFixtureV1[RunnerCreateRequestV1](t, "create-request.json")
	if err := ValidateCreateRequestV1(createRequest); err != nil {
		t.Fatal(err)
	}
	createResponse := readStrictFixtureV1[RunnerCreateResponseV1](t, "create-response.json")
	if err := ValidateCreateResponseV1(createResponse); err != nil {
		t.Fatal(err)
	}
	status := readStrictFixtureV1[RunnerStatusV1](t, "status.json")
	if err := ValidateStatusV1(status); err != nil {
		t.Fatal(err)
	}
	keyRequest := readStrictFixtureV1[StreamKeyIssueRequestV1](t, "key-issue-request.json")
	if err := ValidateStreamKeyIssueRequestV1(keyRequest); err != nil {
		t.Fatal(err)
	}
	keyResponse := readStrictFixtureV1[StreamKeyIssueResponseV1](t, "key-issue-response.json")
	if err := ValidateStreamKeyIssueResponseV1(keyRequest, keyResponse); err != nil {
		t.Fatal(err)
	}
	terminateRequest := readStrictFixtureV1[TerminateRequestV1](t, "terminate-request.json")
	terminateResponse := readStrictFixtureV1[TerminateResponseV1](t, "terminate-response.json")
	if err := ValidateTerminateV1(terminateRequest, terminateResponse); err != nil {
		t.Fatal(err)
	}
	describe := readStrictFixtureV1[DescribeResponseV1](t, "describe.json")
	if err := ValidateDescribeV1(describe); err != nil {
		t.Fatal(err)
	}
}

func TestEventFixtureIsMonotonicAndToleratesExtensions(t *testing.T) {
	file, err := os.Open(fixturePathV1("events.ndjson"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	var previous *RunnerEventV1
	var cursor EventCursorV1
	var count int
	for scanner.Scan() {
		var event RunnerEventV1
		// paid-session/v1 requires a tolerant event reader.
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatal(err)
		}
		if err := ValidateEventV1(event); err != nil {
			t.Fatal(err)
		}
		if err := cursor.Accept(event); err != nil {
			t.Fatal(err)
		}
		if previous != nil {
			if err := ValidateEventAdvanceV1(*previous, event); err != nil {
				t.Fatal(err)
			}
		}
		copy := event
		previous = &copy
		count++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if count != 4 || previous == nil || previous.Usage == nil || previous.Usage.Total != 17 {
		t.Fatalf("event count/final claim = %d/%+v", count, previous)
	}
	decreased := *previous
	decreased.EventID = "runner_session_001:5"
	decreased.Sequence = 5
	decreased.Usage = &UsageV1{Unit: WorkUnitV1, Total: 16}
	if err := cursor.Accept(decreased); err == nil {
		t.Fatal("cumulative usage decrease across events was accepted")
	}
}

func TestSecretPartitionsAndCustomerView(t *testing.T) {
	requestRaw, err := os.ReadFile(fixturePathV1("create-request.json"))
	if err != nil {
		t.Fatal(err)
	}
	response := readStrictFixtureV1[RunnerCreateResponseV1](t, "create-response.json")
	statusRaw, _ := os.ReadFile(fixturePathV1("status.json"))
	eventsRaw, _ := os.ReadFile(fixturePathV1("events.ndjson"))
	customer, err := json.Marshal(CustomerRuntimeV1(response.Runtime.Public))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(requestRaw, []byte("sts-secret-fixture")) || !bytes.Contains(requestRaw, []byte("callback-secret-fixture")) {
		t.Fatal("create fixture does not exercise credential-bearing session_params")
	}
	for surface, body := range map[string][]byte{"status": statusRaw, "events": eventsRaw, "customer": customer} {
		for _, forbidden := range []string{"sts-secret", "session-token", "callback-secret", "grant-secret", "stream-key", "key_issue_url", "access_key_id"} {
			if bytes.Contains(bytes.ToLower(body), []byte(forbidden)) {
				t.Fatalf("%s leaked %q: %s", surface, forbidden, body)
			}
		}
	}
	if !bytes.Contains(customer, []byte("rtmp_url")) || !bytes.Contains(customer, []byte("hls_url")) {
		t.Fatalf("customer view lost safe coordinates: %s", customer)
	}
}

func TestCreateAndKeyIssueReplayIdentity(t *testing.T) {
	request := readStrictFixtureV1[RunnerCreateRequestV1](t, "create-request.json")
	hash, err := CreateFingerprintV1(request)
	if err != nil {
		t.Fatal(err)
	}
	if hash != "a77087d5b62ada2d893480c53ff0c2a36507daded4013870bf45424d033e65ab" {
		t.Fatalf("create fingerprint = %s", hash)
	}
	if ClassifyReplayV1(hash, hash) != ReplayIdenticalV1 {
		t.Fatal("identical create did not replay")
	}
	request.CallbackToken = "different-secret"
	different, _ := CreateFingerprintV1(request)
	if ClassifyReplayV1(hash, different) != RejectIDReuseV1 {
		t.Fatal("different create content was accepted")
	}

	issue := readStrictFixtureV1[StreamKeyIssueRequestV1](t, "key-issue-request.json")
	issueHash, _ := KeyIssueFingerprintV1(issue)
	issue.Audience = "direct-publisher"
	directHash, _ := KeyIssueFingerprintV1(issue)
	if issueHash == directHash || ValidateStreamKeyIssueRequestV1(issue) != nil {
		t.Fatal("direct-publisher issuance is not distinct and supported")
	}
}

func TestOutputSecondsUsesOneFinalizedTimeline(t *testing.T) {
	units, err := CalculateOutputSecondsV1([]uint64{333_333, 333_333, 333_334, 6_250_000})
	if err != nil || units != 7 {
		t.Fatalf("units = %d, err=%v", units, err)
	}
	if _, err := CalculateOutputSecondsV1([]uint64{math.MaxUint64, 1}); err == nil {
		t.Fatal("timeline overflow was accepted")
	}
}

func TestStrictCreateRejectsUnknownFieldsWithoutEchoingValues(t *testing.T) {
	raw, err := os.ReadFile(fixturePathV1("create-request.json"))
	if err != nil {
		t.Fatal(err)
	}
	raw = bytes.Replace(raw, []byte(`"session_id":`), []byte(`"unexpected_secret":"do-not-echo","session_id":`), 1)
	var request RunnerCreateRequestV1
	err = DecodeStrictV1(bytes.NewReader(raw), &request)
	if err == nil || strings.Contains(err.Error(), "do-not-echo") {
		t.Fatalf("strict decode error = %v", err)
	}
}

func TestTerminalReasonsCannotCarryCredentials(t *testing.T) {
	request := TerminateRequestV1{Reason: "https://storage.example?sig=secret"}
	response := TerminateResponseV1{RunnerSessionID: "runner_session_001", State: "ended", CloseReason: request.Reason}
	if err := ValidateTerminateV1(request, response); err == nil || strings.Contains(err.Error(), "storage.example") {
		t.Fatalf("unsafe close reason validation = %v", err)
	}
}

func readStrictFixtureV1[T any](t *testing.T, name string) T {
	t.Helper()
	file, err := os.Open(fixturePathV1(name))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	var value T
	if err := DecodeStrictV1(file, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func fixturePathV1(name string) string {
	return filepath.Join("testdata", "contracts", "v1", name)
}
