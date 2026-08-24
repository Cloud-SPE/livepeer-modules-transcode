package liverunner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCallbackDispatcherRetriesWithoutChangingEventIdentity(t *testing.T) {
	var attempts atomic.Int32
	var firstBody []byte
	broker := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body := new(bytes.Buffer)
		_, _ = body.ReadFrom(request.Body)
		if request.Header.Get("Authorization") != "Bearer callback-secret-fixture" || request.Header.Get("Content-Type") != "application/json" {
			t.Error("callback credentials or media type missing")
		}
		if attempts.Add(1) == 1 {
			firstBody = append([]byte(nil), body.Bytes()...)
			http.Error(writer, "temporary", http.StatusServiceUnavailable)
			return
		}
		if !bytes.Equal(firstBody, body.Bytes()) {
			t.Error("callback retry changed the event envelope")
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"accepted": true, "duplicate": true})
	}))
	defer broker.Close()

	store, request, response := callbackTestSessionV1(t, broker.URL)
	event := testEventV1(response.RunnerSessionID, 1, "session.usage.tick", "active", 7, "")
	if err := store.Advance(request.SessionID, event); err != nil {
		t.Fatal(err)
	}
	dispatcher, err := NewCallbackDispatcherV1(store, nil, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	delivered, err := dispatcher.DeliverNext(context.Background(), request.SessionID)
	var deliveryError *CallbackDeliveryErrorV1
	if delivered || !errors.As(err, &deliveryError) || !deliveryError.Retryable || deliveryError.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("first delivery=%v err=%+v", delivered, err)
	}
	record, _, err := store.Load(request.SessionID)
	if err != nil || len(record.PendingEvents) != 1 || record.PendingEvents[0].EventID != event.EventID {
		t.Fatalf("retry outbox=%+v err=%v", record.PendingEvents, err)
	}
	delivered, err = dispatcher.DeliverNext(context.Background(), request.SessionID)
	if err != nil || !delivered {
		t.Fatalf("retry delivery=%v err=%v", delivered, err)
	}
	record, _, err = store.Load(request.SessionID)
	if err != nil || len(record.PendingEvents) != 0 || attempts.Load() != 2 {
		t.Fatalf("final outbox=%+v attempts=%d err=%v", record.PendingEvents, attempts.Load(), err)
	}
}

func TestCallbackDispatcherPreservesOutboxOrder(t *testing.T) {
	var sequences []uint64
	broker := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var event RunnerEventV1
		if err := json.NewDecoder(request.Body).Decode(&event); err != nil {
			t.Error(err)
		}
		sequences = append(sequences, event.Sequence)
		writer.WriteHeader(http.StatusOK)
	}))
	defer broker.Close()
	store, request, response := callbackTestSessionV1(t, broker.URL)
	for sequence := uint64(1); sequence <= 2; sequence++ {
		event := testEventV1(response.RunnerSessionID, sequence, "session.heartbeat", "active", 0, "")
		if err := store.Advance(request.SessionID, event); err != nil {
			t.Fatal(err)
		}
	}
	dispatcher, _ := NewCallbackDispatcherV1(store, nil, time.Second)
	for range 2 {
		if delivered, err := dispatcher.DeliverNext(context.Background(), request.SessionID); err != nil || !delivered {
			t.Fatalf("delivery=%v err=%v", delivered, err)
		}
	}
	if len(sequences) != 2 || sequences[0] != 1 || sequences[1] != 2 {
		t.Fatalf("callback sequence=%v", sequences)
	}
}

func TestCallbackDispatcherRejectsRedirectsAndClassifiesPermanentFailures(t *testing.T) {
	var redirected atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Store(true) }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, target.URL, http.StatusTemporaryRedirect)
	}))
	defer redirect.Close()
	store, request, response := callbackTestSessionV1(t, redirect.URL)
	if err := store.Advance(request.SessionID, testEventV1(response.RunnerSessionID, 1, "session.heartbeat", "active", 0, "")); err != nil {
		t.Fatal(err)
	}
	dispatcher, _ := NewCallbackDispatcherV1(store, nil, time.Second)
	_, err := dispatcher.DeliverNext(context.Background(), request.SessionID)
	var deliveryError *CallbackDeliveryErrorV1
	if !errors.As(err, &deliveryError) || deliveryError.Retryable || deliveryError.StatusCode != http.StatusTemporaryRedirect || redirected.Load() {
		t.Fatalf("redirect error=%+v followed=%v", err, redirected.Load())
	}
}

func TestCallbackDispatcherDoesNotEchoCallbackCoordinates(t *testing.T) {
	store, request, response := callbackTestSessionV1(t, "http://127.0.0.1:1/path-containing-secret")
	if err := store.Advance(request.SessionID, testEventV1(response.RunnerSessionID, 1, "session.heartbeat", "active", 0, "")); err != nil {
		t.Fatal(err)
	}
	dispatcher, _ := NewCallbackDispatcherV1(store, nil, 50*time.Millisecond)
	_, err := dispatcher.DeliverNext(context.Background(), request.SessionID)
	if err == nil || strings.Contains(err.Error(), "path-containing-secret") || strings.Contains(err.Error(), "127.0.0.1") {
		t.Fatalf("unsafe callback error=%v", err)
	}
}

func TestCallbackWorkerRetriesTerminalOutboxThenErasesSecrets(t *testing.T) {
	var attempts atomic.Int32
	var sequences []uint64
	broker := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var event RunnerEventV1
		if err := json.NewDecoder(request.Body).Decode(&event); err != nil {
			t.Error(err)
		}
		attempt := attempts.Add(1)
		if attempt == 1 {
			writer.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		sequences = append(sequences, event.Sequence)
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer broker.Close()
	store, request, response := callbackTestSessionV1(t, broker.URL)
	if err := store.Advance(request.SessionID, testEventV1(response.RunnerSessionID, 1, "session.started", "active", 0, "")); err != nil {
		t.Fatal(err)
	}
	record, _, err := store.BeginTermination(request.SessionID, "gateway_close")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Advance(request.SessionID, testEventV1(response.RunnerSessionID, record.LastSequence+1, "session.ended", "ended", 0, "gateway_close")); err != nil {
		t.Fatal(err)
	}
	dispatcher, _ := NewCallbackDispatcherV1(store, nil, time.Second)
	worker, _ := NewCallbackWorkerV1(store, dispatcher, 5*time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- worker.Run(ctx) }()
	for {
		persisted, secrets, loadErr := store.Load(request.SessionID)
		if loadErr != nil {
			t.Fatal(loadErr)
		}
		if len(persisted.PendingEvents) == 0 && secrets == nil {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("worker exited before drain: %v", err)
		case <-time.After(5 * time.Millisecond):
		}
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if attempts.Load() != 3 || len(sequences) != 2 || sequences[0] != 1 || sequences[1] != 2 {
		t.Fatalf("attempts=%d acknowledged sequences=%v", attempts.Load(), sequences)
	}
}

func TestCallbackWorkerRecoversAcknowledgedTerminalSecretErase(t *testing.T) {
	broker := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) { writer.WriteHeader(http.StatusNoContent) }))
	defer broker.Close()
	store, request, response := callbackTestSessionV1(t, broker.URL)
	record, _, err := store.BeginTermination(request.SessionID, "gateway_close")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Advance(request.SessionID, testEventV1(response.RunnerSessionID, record.LastSequence+1, "session.ended", "ended", 0, "gateway_close")); err != nil {
		t.Fatal(err)
	}
	dispatcher, _ := NewCallbackDispatcherV1(store, nil, time.Second)
	if delivered, err := dispatcher.DeliverNext(context.Background(), request.SessionID); err != nil || !delivered {
		t.Fatalf("delivery=%v err=%v", delivered, err)
	}
	before, secrets, err := store.Load(request.SessionID)
	if err != nil || secrets == nil || len(before.PendingEvents) != 0 {
		t.Fatalf("pre-recovery record=%+v secrets=%+v err=%v", before, secrets, err)
	}
	restarted := newTestStoreV1(t, store.dir, bytes.Repeat([]byte{0x55}, 32))
	restartedDispatcher, _ := NewCallbackDispatcherV1(restarted, nil, time.Second)
	worker, _ := NewCallbackWorkerV1(restarted, restartedDispatcher, time.Second)
	if err := worker.SweepOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	after, secrets, err := restarted.Load(request.SessionID)
	if err != nil || secrets != nil || after.WrappedKeyCiphertext != "" {
		t.Fatalf("recovered record=%+v secrets=%+v err=%v", after, secrets, err)
	}
}

func TestCallbackWorkerRetainsPermanentFailureAtBoundedCadence(t *testing.T) {
	var attempts atomic.Int32
	broker := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		attempts.Add(1)
		writer.WriteHeader(http.StatusUnauthorized)
	}))
	defer broker.Close()
	store, request, response := callbackTestSessionV1(t, broker.URL)
	if err := store.Advance(request.SessionID, testEventV1(response.RunnerSessionID, 1, "session.heartbeat", "active", 0, "")); err != nil {
		t.Fatal(err)
	}
	dispatcher, _ := NewCallbackDispatcherV1(store, nil, time.Second)
	worker, _ := NewCallbackWorkerV1(store, dispatcher, 100*time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- worker.Run(ctx) }()
	deadline := time.Now().Add(time.Second)
	for attempts.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond)
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	record, _, err := store.Load(request.SessionID)
	if err != nil || attempts.Load() != 1 || len(record.PendingEvents) != 1 || record.PendingEvents[0].EventID != response.RunnerSessionID+":1" {
		t.Fatalf("attempts=%d record=%+v err=%v", attempts.Load(), record, err)
	}
}

func callbackTestSessionV1(t *testing.T, callbackURL string) (*EncryptedFileSessionStoreV1, RunnerCreateRequestV1, RunnerCreateResponseV1) {
	t.Helper()
	store := newTestStoreV1(t, t.TempDir(), bytes.Repeat([]byte{0x55}, 32))
	request, response := testCreatePairV1(t)
	request.CallbackURL = callbackURL
	if _, _, _, err := store.CreateOrReplay(request, response); err != nil {
		t.Fatal(err)
	}
	return store, request, response
}
