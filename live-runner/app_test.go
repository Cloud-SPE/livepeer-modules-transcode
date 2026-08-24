package liverunner

import (
	"bytes"
	"encoding/base64"
	"os"
	"strings"
	"testing"
	"time"

	transcode "github.com/Cloud-SPE/livepeer-modules-transcode/transcode-core"
)

func TestLoadLiveRunnerConfigRequiresSecretsAndPublicCoordinates(t *testing.T) {
	values := map[string]string{
		"LIVE_RUNNER_MASTER_KEY":           base64.StdEncoding.EncodeToString([]byte(strings.Repeat("m", 32))),
		"LIVE_RUNNER_BROKER_TOKEN":         strings.Repeat("b", 32),
		"LIVE_RUNNER_INTERNAL_MEDIA_TOKEN": strings.Repeat("i", 32),
		"LIVE_RUNNER_PUBLIC_RTMP_URL":      "rtmps://runner.example/ingest",
		"LIVE_RUNNER_PUBLIC_HLS_BASE":      "https://runner.example",
		"LIVE_RUNNER_PUBLIC_API_BASE":      "https://runner.example",
		"LIVE_RUNNER_PRESETS_FILE":         "/etc/live-runner/presets.yaml",
	}
	config, err := LoadLiveRunnerConfigV1(func(name string) string { return values[name] })
	if err != nil {
		t.Fatal(err)
	}
	if config.ListenAddress != ":8080" || config.MediaMTX.APIAddress != "127.0.0.1:9997" || config.MaxConcurrent != 0 || len(config.MasterKey) != 32 {
		t.Fatal("valid configuration did not produce the expected safe defaults")
	}
	delete(values, "LIVE_RUNNER_BROKER_TOKEN")
	if _, err := LoadLiveRunnerConfigV1(func(name string) string { return values[name] }); err == nil || strings.Contains(err.Error(), strings.Repeat("b", 32)) {
		t.Fatalf("missing secret error=%v", err)
	}
}

func TestPackagedLivePresetsSupportSoftwareFallback(t *testing.T) {
	body, err := os.ReadFile("presets.yaml")
	if err != nil {
		t.Fatal(err)
	}
	presets, err := transcode.LoadABRPresetsFromBytes(body)
	if err != nil {
		t.Fatal(err)
	}
	store := newTestStoreV1(t, t.TempDir(), bytes.Repeat([]byte{0x79}, 32))
	runtime, err := NewLiveRuntimeCoordinatorV1(store, fakePublisherWaiterV1{ready: make(chan struct{})}, &fakeLiveLauncherV1{}, presets, transcode.HWProfile{}, "rtmp://127.0.0.1:1935", strings.Repeat("i", 32), time.Millisecond, 1)
	if err != nil {
		t.Fatal(err)
	}
	request := readStrictFixtureV1[RunnerCreateRequestV1](t, "create-request.json")
	request.SessionParams.OutputProfile = "live-standard"
	request.SessionParams.MeteringRendition = "720p"
	if err := runtime.ValidateSession(request); err != nil {
		t.Fatalf("packaged software live preset rejected: %v", err)
	}
}

func TestLoadLiveRunnerConfigRejectsMalformedValues(t *testing.T) {
	values := map[string]string{"LIVE_RUNNER_MASTER_KEY": "not-base64"}
	if _, err := LoadLiveRunnerConfigV1(func(name string) string { return values[name] }); err == nil {
		t.Fatal("malformed master key was accepted")
	}
}
