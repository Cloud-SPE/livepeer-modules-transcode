package liverunner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

type CallbackDeliveryErrorV1 struct {
	StatusCode int
	Retryable  bool
}

func (e *CallbackDeliveryErrorV1) Error() string {
	if e.StatusCode == 0 {
		return "runner event callback transport failed"
	}
	return fmt.Sprintf("runner event callback returned HTTP %d", e.StatusCode)
}

type CallbackDispatcherV1 struct {
	store  *EncryptedFileSessionStoreV1
	client *http.Client
}

func NewCallbackDispatcherV1(store *EncryptedFileSessionStoreV1, transport http.RoundTripper, timeout time.Duration) (*CallbackDispatcherV1, error) {
	if store == nil || timeout <= 0 {
		return nil, errors.New("session store and positive callback timeout are required")
	}
	if transport == nil {
		transport = http.DefaultTransport
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	return &CallbackDispatcherV1{store: store, client: client}, nil
}

// DeliverNext posts at most one durable event. A successful broker response
// removes only the head of the outbox, preserving strict per-session order.
func (d *CallbackDispatcherV1) DeliverNext(ctx context.Context, brokerSessionID string) (bool, error) {
	record, secrets, err := d.store.Load(brokerSessionID)
	if err != nil {
		return false, err
	}
	if len(record.PendingEvents) == 0 {
		return false, nil
	}
	if secrets == nil {
		return false, errors.New("pending runner event has no callback credentials")
	}
	event := record.PendingEvents[0]
	body, err := json.Marshal(event)
	if err != nil {
		return false, errors.New("runner event serialization failed")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, secrets.CreateRequest.CallbackURL, bytes.NewReader(body))
	if err != nil {
		return false, errors.New("runner event callback request failed")
	}
	request.Header.Set("Authorization", "Bearer "+secrets.CreateRequest.CallbackToken)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "livepeer-modules-transcode-live-runner/1")
	response, err := d.client.Do(request)
	if err != nil {
		return false, &CallbackDeliveryErrorV1{Retryable: true}
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		retryable := response.StatusCode == http.StatusRequestTimeout || response.StatusCode == http.StatusTooManyRequests || response.StatusCode >= 500
		return false, &CallbackDeliveryErrorV1{StatusCode: response.StatusCode, Retryable: retryable}
	}
	if err := d.store.AcknowledgeEvent(brokerSessionID, event.EventID); err != nil {
		return false, err
	}
	return true, nil
}
