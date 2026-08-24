package liverunner

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	transcode "github.com/Cloud-SPE/livepeer-modules-transcode/transcode-core"
)

type fakePublisherWaiterV1 struct {
	ready   <-chan struct{}
	kicked  chan<- string
	kickErr error
}

func (f fakePublisherWaiterV1) KickPublisher(_ context.Context, path string) error {
	if f.kicked != nil {
		f.kicked <- path
	}
	return f.kickErr
}

func (f fakePublisherWaiterV1) WaitForRTMPPublisher(ctx context.Context, path string, _ time.Duration) (MediaPathStatusV1, error) {
	select {
	case <-ctx.Done():
		return MediaPathStatusV1{}, ctx.Err()
	case <-f.ready:
		return MediaPathStatusV1{Name: path, Online: true, Source: &MediaPathSourceV1{Type: "rtmpConn"}}, nil
	}
}

type fakeLiveProcessV1 struct {
	ctx context.Context
}

func (p fakeLiveProcessV1) Wait() error {
	<-p.ctx.Done()
	return p.ctx.Err()
}

type liveLaunchV1 struct {
	input   string
	outputs []transcode.LiveRTMPOutput
}

type fakeLiveLauncherV1 struct {
	mu       sync.Mutex
	launches []liveLaunchV1
	started  chan struct{}
}

func (f *fakeLiveLauncherV1) Start(ctx context.Context, input string, outputs []transcode.LiveRTMPOutput, _ transcode.HWProfile, _ transcode.ProbeResult) (LiveLadderProcessV1, error) {
	f.mu.Lock()
	f.launches = append(f.launches, liveLaunchV1{input: input, outputs: append([]transcode.LiveRTMPOutput(nil), outputs...)})
	f.mu.Unlock()
	select {
	case f.started <- struct{}{}:
	default:
	}
	return fakeLiveProcessV1{ctx: ctx}, nil
}

func TestLiveRuntimeWaitsForPublisherLaunchesOnceAndTerminates(t *testing.T) {
	ready := make(chan struct{})
	kicked := make(chan string, 1)
	launcher := &fakeLiveLauncherV1{started: make(chan struct{}, 2)}
	store := newTestStoreV1(t, t.TempDir(), bytes.Repeat([]byte{0x72}, 32))
	coordinator := newTestRuntimeCoordinatorV1(t, store, fakePublisherWaiterV1{ready: ready, kicked: kicked}, launcher, 1)
	record, secrets := createRuntimeSessionV1(t, store, "sess_runtime_001", "runner_runtime_001")
	if err := coordinator.EnsureSession(context.Background(), record, secrets); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.EnsureSession(context.Background(), record, secrets); err != nil {
		t.Fatal(err)
	}
	select {
	case <-launcher.started:
		t.Fatal("FFmpeg started before an RTMP publisher was online")
	default:
	}
	close(ready)
	select {
	case <-launcher.started:
	case <-time.After(time.Second):
		t.Fatal("FFmpeg did not start after publisher readiness")
	}
	launcher.mu.Lock()
	if len(launcher.launches) != 1 {
		t.Fatalf("launch count=%d", len(launcher.launches))
	}
	launch := launcher.launches[0]
	launcher.mu.Unlock()
	if !strings.HasPrefix(launch.input, "rtmp://127.0.0.1:1935/ingest/runner_runtime_001?token=") || len(launch.outputs) != 2 {
		t.Fatalf("launch input=%q outputs=%+v", launch.input, launch.outputs)
	}
	for _, output := range launch.outputs {
		if !strings.Contains(output.URL, "/renditions/runner_runtime_001/"+output.Rendition.Name+"?token=") {
			t.Fatalf("rendition URL=%q", output.URL)
		}
	}
	persisted, _, err := store.Load(record.BrokerSessionID)
	if err != nil || persisted.LastSequence != 1 || len(persisted.PendingEvents) != 1 || persisted.PendingEvents[0].EventType != "session.started" {
		t.Fatalf("started event=%+v err=%v", persisted, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := coordinator.TerminateSession(ctx, record); err != nil {
		t.Fatal(err)
	}
	select {
	case path := <-kicked:
		if path != "ingest/runner_runtime_001" {
			t.Fatalf("terminated ingest path=%q", path)
		}
	default:
		t.Fatal("termination did not kick the ingest publisher")
	}
}

func TestLiveRuntimeTerminationWithoutActiveFFmpegPropagatesKickFailure(t *testing.T) {
	kicked := make(chan string, 1)
	wantErr := errors.New("router unavailable")
	store := newTestStoreV1(t, t.TempDir(), bytes.Repeat([]byte{0x76}, 32))
	router := fakePublisherWaiterV1{ready: make(chan struct{}), kicked: kicked, kickErr: wantErr}
	coordinator := newTestRuntimeCoordinatorV1(t, store, router, &fakeLiveLauncherV1{}, 1)
	record, _ := createRuntimeSessionV1(t, store, "sess_runtime_003", "runner_runtime_003")
	if err := coordinator.TerminateSession(context.Background(), record); !errors.Is(err, wantErr) {
		t.Fatalf("termination error=%v", err)
	}
	select {
	case path := <-kicked:
		if path != "ingest/runner_runtime_003" {
			t.Fatalf("terminated ingest path=%q", path)
		}
	default:
		t.Fatal("termination did not attempt to kick the ingest publisher")
	}
}

func TestLiveRuntimeRestartDoesNotDuplicateStartedEvent(t *testing.T) {
	ready := make(chan struct{})
	launcher := &fakeLiveLauncherV1{started: make(chan struct{}, 4)}
	store := newTestStoreV1(t, t.TempDir(), bytes.Repeat([]byte{0x73}, 32))
	first := newTestRuntimeCoordinatorV1(t, store, fakePublisherWaiterV1{ready: ready}, launcher, 1)
	record, secrets := createRuntimeSessionV1(t, store, "sess_runtime_002", "runner_runtime_002")
	if err := first.EnsureSession(context.Background(), record, secrets); err != nil {
		t.Fatal(err)
	}
	shutdownContext, cancel := context.WithTimeout(context.Background(), time.Second)
	if err := first.Shutdown(shutdownContext); err != nil {
		t.Fatal(err)
	}
	cancel()
	persisted, persistedSecrets, err := store.Load(record.BrokerSessionID)
	if err != nil || persistedSecrets == nil {
		t.Fatal(err)
	}
	second := newTestRuntimeCoordinatorV1(t, store, fakePublisherWaiterV1{ready: ready}, launcher, 1)
	if err := second.EnsureSession(context.Background(), persisted, *persistedSecrets); err != nil {
		t.Fatal(err)
	}
	defer second.Shutdown(context.Background())
	persisted, _, err = store.Load(record.BrokerSessionID)
	if err != nil || persisted.LastSequence != 1 || len(persisted.PendingEvents) != 1 {
		t.Fatalf("restart duplicated started event: sequence=%d pending=%d err=%v", persisted.LastSequence, len(persisted.PendingEvents), err)
	}
}

func TestLiveRuntimeValidatesProfileAndMeteringRendition(t *testing.T) {
	ready := make(chan struct{})
	store := newTestStoreV1(t, t.TempDir(), bytes.Repeat([]byte{0x74}, 32))
	coordinator := newTestRuntimeCoordinatorV1(t, store, fakePublisherWaiterV1{ready: ready}, &fakeLiveLauncherV1{started: make(chan struct{}, 1)}, 1)
	request := readStrictFixtureV1[RunnerCreateRequestV1](t, "create-request.json")
	request.SessionParams.OutputProfile = "unknown"
	if err := coordinator.ValidateSession(request); err == nil {
		t.Fatal("unknown live profile was accepted")
	}
	request.SessionParams.OutputProfile = "live-standard"
	request.SessionParams.MeteringRendition = "missing"
	if err := coordinator.ValidateSession(request); err == nil {
		t.Fatal("missing metering rendition was accepted")
	}
	request.SessionParams.MeteringRendition = "720p"
	if err := coordinator.ValidateSession(request); err != nil {
		t.Fatalf("valid live profile rejected: %v", err)
	}
}

func TestLiveRuntimeConstructorRejectsNonRTMPRouter(t *testing.T) {
	store := newTestStoreV1(t, t.TempDir(), bytes.Repeat([]byte{0x75}, 32))
	_, err := NewLiveRuntimeCoordinatorV1(store, fakePublisherWaiterV1{ready: make(chan struct{})}, &fakeLiveLauncherV1{}, testLivePresetsV1(), transcode.HWProfile{}, "http://127.0.0.1:1935", strings.Repeat("x", 32), time.Millisecond, 1)
	if err == nil {
		t.Fatal("non-RTMP internal router URL was accepted")
	}
}

func newTestRuntimeCoordinatorV1(t *testing.T, store *EncryptedFileSessionStoreV1, router MediaPublisherWaiterV1, launcher LiveLadderLauncherV1, capacity int) *LiveRuntimeCoordinatorV1 {
	t.Helper()
	coordinator, err := NewLiveRuntimeCoordinatorV1(store, router, launcher, testLivePresetsV1(), transcode.HWProfile{}, "rtmp://127.0.0.1:1935", strings.Repeat("i", 32), time.Millisecond, capacity)
	if err != nil {
		t.Fatal(err)
	}
	return coordinator
}

func createRuntimeSessionV1(t *testing.T, store *EncryptedFileSessionStoreV1, brokerSessionID, runnerSessionID string) (SessionRecordV1, SessionSecretsV1) {
	t.Helper()
	request, response := testCreatePairV1(t)
	request.SessionID = brokerSessionID
	request.SessionParams.OutputProfile = "live-standard"
	response.RunnerSessionID = runnerSessionID
	response.Runtime.Public.HLSURL = "https://runner.example/hls/" + runnerSessionID + "/master.m3u8"
	response.Runtime.Public.KeyIssueURL = "https://runner.example/v1/sessions/" + runnerSessionID + "/stream-keys"
	response.Runtime.Public.StatusURL = "https://runner.example/v1/public/sessions/" + runnerSessionID + "/status"
	record, secrets, _, err := store.CreateOrReplay(request, response)
	if err != nil {
		t.Fatal(err)
	}
	return record, secrets
}

func testLivePresetsV1() []transcode.ABRPreset {
	return []transcode.ABRPreset{{
		Name: "live-standard", Renditions: []transcode.ABRRendition{
			{Name: "720p", Video: &transcode.ABRVideoSettings{Codec: "h264", Width: 1280, Height: 720, Bitrate: "2.5M", MaxBitrate: "3.75M"}, Audio: transcode.ABRAudioSettings{Codec: "aac", Bitrate: "96k", Channels: 2}},
			{Name: "360p", Video: &transcode.ABRVideoSettings{Codec: "h264", Width: 640, Height: 360, Bitrate: "600k", MaxBitrate: "900k"}, Audio: transcode.ABRAudioSettings{Codec: "aac", Bitrate: "64k", Channels: 2}},
		}, SegmentDuration: 1,
	}}
}
