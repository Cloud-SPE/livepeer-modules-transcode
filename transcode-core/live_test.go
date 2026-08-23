package transcode

import (
	"context"
	"strings"
	"testing"
)

func TestLiveLadderCmdDecodesOnceAndPublishesEveryRendition(t *testing.T) {
	hardware := HWProfile{Vendor: VendorNVIDIA, Encoders: []string{"h264_nvenc"}, HWAccels: []string{"cuda"}}
	outputs := []LiveRTMPOutput{
		{Rendition: liveTestRendition("360p", 640, 360, "800k"), URL: "rtmp://127.0.0.1/output/session/360p?pass=secret-one"},
		{Rendition: liveTestRendition("720p", 1280, 720, "2800k"), URL: "rtmp://127.0.0.1/output/session/720p?pass=secret-two"},
	}
	cmd, err := LiveLadderCmdContext(context.Background(), "rtmp://127.0.0.1/source/session?pass=input-secret", outputs, hardware, ProbeResult{Width: 1920, Height: 1080})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(cmd.Args, " ")
	for _, want := range []string{
		"-fflags +nobuffer", "-flags +low_delay", "-progress pipe:2",
		"-hwaccel cuda", "-c:v h264_nvenc", "scale_cuda=640:360", "scale_cuda=1280:720",
		"-f flv " + outputs[0].URL, "-f flv " + outputs[1].URL,
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q in %s", want, joined)
		}
	}
	if strings.Count(joined, " -i ") != 1 {
		t.Fatalf("input count = %d, command=%s", strings.Count(joined, " -i "), joined)
	}
	if strings.Contains(joined, "hwupload") {
		t.Fatalf("hardware-decoded frames were uploaded again: %s", joined)
	}
}

func TestLiveLadderCmdRejectsDuplicateAndUnsupportedOutputs(t *testing.T) {
	r := liveTestRendition("same", 1280, 720, "2M")
	if _, err := LiveLadderCmdContext(context.Background(), "rtmp://source/live", []LiveRTMPOutput{{Rendition: r, URL: "rtmp://out/one"}, {Rendition: r, URL: "rtmp://out/two"}}, HWProfile{}, ProbeResult{}); err == nil {
		t.Fatal("duplicate rendition was accepted")
	}
	r.Name = "av1"
	r.Video.Codec = "av1"
	if _, err := LiveLadderCmdContext(context.Background(), "rtmp://source/live", []LiveRTMPOutput{{Rendition: r, URL: "rtmp://out/av1"}}, HWProfile{}, ProbeResult{}); err == nil {
		t.Fatal("unsupported RTMP codec was accepted")
	}
}

func liveTestRendition(name string, width, height int, bitrate string) ABRRendition {
	return ABRRendition{
		Name:  name,
		Video: &ABRVideoSettings{Codec: "h264", Width: width, Height: height, Bitrate: bitrate},
		Audio: ABRAudioSettings{Codec: "aac", Bitrate: "128k", Channels: 2},
	}
}
