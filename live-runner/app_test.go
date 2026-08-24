package liverunner

import (
	"encoding/base64"
	"strings"
	"testing"
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

func TestLoadLiveRunnerConfigRejectsMalformedValues(t *testing.T) {
	values := map[string]string{"LIVE_RUNNER_MASTER_KEY": "not-base64"}
	if _, err := LoadLiveRunnerConfigV1(func(name string) string { return values[name] }); err == nil {
		t.Fatal("malformed master key was accepted")
	}
}
