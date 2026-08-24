package liverunner

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHLSHandlerServesMasterAndStrictRenditionAssets(t *testing.T) {
	var upstreamRequest *http.Request
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		upstreamRequest = request.Clone(context.Background())
		if strings.HasSuffix(request.URL.Path, "/redirect.m3u8") {
			writer.Header().Set("Location", "https://attacker.example/playlist.m3u8")
			writer.WriteHeader(http.StatusFound)
			return
		}
		writer.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		writer.Header().Set("Set-Cookie", "secret=unsafe")
		writer.Header().Set("X-Upstream-Internal", "unsafe")
		writer.WriteHeader(http.StatusPartialContent)
		_, _ = writer.Write([]byte("#EXTM3U\n#EXT-X-PART:URI=\"part0.mp4\"\n"))
	}))
	defer upstream.Close()
	store := newTestStoreV1(t, t.TempDir(), bytes.Repeat([]byte{0x7a}, 32))
	record, _ := createRuntimeSessionV1(t, store, "sess_hls_001", "runner_hls_001")
	handler, err := NewHLSHandlerV1(store, testLivePresetsV1(), upstream.URL, nil, time.Second)
	if err != nil {
		t.Fatal(err)
	}

	master := hlsRequestV1(t, handler, record.RunnerSessionID, "master.m3u8", "")
	if master.Code != http.StatusOK || master.Header().Get("Cache-Control") != "no-store" || !strings.Contains(master.Body.String(), "BANDWIDTH=3846000,RESOLUTION=1280x720,CODECS=\"avc1.64001f,mp4a.40.2\"") || !strings.Contains(master.Body.String(), "720p/index.m3u8") {
		t.Fatalf("master=%d headers=%v body=%q", master.Code, master.Header(), master.Body.String())
	}

	assetRequest := httptest.NewRequest(http.MethodGet, "/v1/public/sessions/"+record.RunnerSessionID+"/720p/index.m3u8?_HLS_msn=4&_HLS_part=2", nil)
	assetRequest.SetPathValue("id", record.RunnerSessionID)
	assetRequest.SetPathValue("asset", "720p/index.m3u8")
	assetRequest.Header.Set("Authorization", "Bearer must-not-forward")
	assetRequest.Header.Set("Cookie", "must-not-forward=1")
	assetRequest.Header.Set("Range", "bytes=0-99")
	asset := httptest.NewRecorder()
	handler.ServeHTTP(asset, assetRequest)
	if asset.Code != http.StatusPartialContent || asset.Body.String() == "" || asset.Header().Get("Set-Cookie") != "" || asset.Header().Get("X-Upstream-Internal") != "" || asset.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("asset=%d headers=%v body=%q", asset.Code, asset.Header(), asset.Body.String())
	}
	if upstreamRequest == nil || upstreamRequest.URL.Path != "/renditions/runner_hls_001/720p/index.m3u8" || upstreamRequest.URL.RawQuery != "_HLS_msn=4&_HLS_part=2" || upstreamRequest.Header.Get("Range") != "bytes=0-99" || upstreamRequest.Header.Get("Authorization") != "" || upstreamRequest.Header.Get("Cookie") != "" {
		t.Fatalf("upstream request=%+v", upstreamRequest)
	}
	redirect := hlsRequestV1(t, handler, record.RunnerSessionID, "720p/redirect.m3u8", "")
	if redirect.Code != http.StatusBadGateway || redirect.Header().Get("Location") != "" {
		t.Fatalf("upstream redirect=%d headers=%v", redirect.Code, redirect.Header())
	}
}

func TestHLSHandlerRejectsUndeclaredTraversalQueryAndTerminalSession(t *testing.T) {
	upstreamCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { upstreamCalls++ }))
	defer upstream.Close()
	store := newTestStoreV1(t, t.TempDir(), bytes.Repeat([]byte{0x7b}, 32))
	record, _ := createRuntimeSessionV1(t, store, "sess_hls_002", "runner_hls_002")
	handler, _ := NewHLSHandlerV1(store, testLivePresetsV1(), upstream.URL, nil, time.Second)
	for _, test := range []struct{ asset, query string }{
		{"1080p/index.m3u8", ""},
		{"720p/../index.m3u8", ""},
		{"720p/index.m3u8", "token=unsafe"},
		{"720p/index.m3u8", "_HLS_msn=not-a-number"},
		{"720p/secret.json", ""},
	} {
		response := hlsRequestV1(t, handler, record.RunnerSessionID, test.asset, test.query)
		if response.Code != http.StatusNotFound {
			t.Fatalf("asset=%q query=%q status=%d", test.asset, test.query, response.Code)
		}
	}
	stopping, _, err := store.BeginTermination(record.BrokerSessionID, "gateway_close")
	if err != nil || !stopping.Stopping {
		t.Fatal(err)
	}
	if response := hlsRequestV1(t, handler, record.RunnerSessionID, "master.m3u8", ""); response.Code != http.StatusNotFound {
		t.Fatalf("stopping master status=%d", response.Code)
	}
	if upstreamCalls != 0 {
		t.Fatalf("rejected HLS requests reached upstream %d times", upstreamCalls)
	}
}

func hlsRequestV1(t *testing.T, handler http.Handler, runnerID, asset, query string) *httptest.ResponseRecorder {
	t.Helper()
	target := "/v1/public/sessions/" + runnerID + "/" + asset
	if query != "" {
		target += "?" + query
	}
	request := httptest.NewRequest(http.MethodGet, target, nil)
	request.SetPathValue("id", runnerID)
	request.SetPathValue("asset", asset)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
