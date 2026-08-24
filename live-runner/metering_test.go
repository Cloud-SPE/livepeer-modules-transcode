package liverunner

import (
	"strings"
	"testing"
)

func TestParseFinalizedHLSSegmentsIgnoresPartsAndAggregatesExactDurations(t *testing.T) {
	playlist := "\ufeff#EXTM3U\r\n" +
		"#EXT-X-VERSION:9\r\n" +
		"#EXT-X-MEDIA-SEQUENCE:41\r\n" +
		"#EXT-X-PART:DURATION=0.20000,URI=part0.mp4\r\n" +
		"#EXTINF:0.333333,\r\nsegment41.mp4\r\n" +
		"#EXT-X-PART:DURATION=0.2,URI=part1.mp4\r\n" +
		"#EXTINF:0.666667,title\r\nsegment42.mp4\r\n"
	segments, err := ParseFinalizedHLSSegmentsV1(strings.NewReader(playlist))
	if err != nil {
		t.Fatal(err)
	}
	if len(segments) != 2 || segments[0].URI != "segment41.mp4" || segments[0].DurationMicroseconds != 333333 || segments[1].URI != "segment42.mp4" || segments[1].DurationMicroseconds != 666667 {
		t.Fatalf("segments=%+v", segments)
	}
	durations := []uint64{segments[0].DurationMicroseconds, segments[1].DurationMicroseconds}
	if total, err := CalculateOutputSecondsV1(durations); err != nil || total != 1 {
		t.Fatalf("total=%d err=%v", total, err)
	}
}

func TestParseFinalizedHLSSegmentsDeduplicatesPlaylistEntries(t *testing.T) {
	playlist := "#EXTM3U\n#EXTINF:1.0,\nsegment.mp4\n#EXTINF:1.0,\nsegment.mp4\n"
	segments, err := ParseFinalizedHLSSegmentsV1(strings.NewReader(playlist))
	if err != nil || len(segments) != 1 {
		t.Fatalf("segments=%+v err=%v", segments, err)
	}
}

func TestParseFinalizedHLSSegmentsRejectsMalformedOrAmbiguousInput(t *testing.T) {
	tests := []string{
		"not-hls\n",
		"#EXTM3U\n#EXT-X-PART:DURATION=1,URI=part.mp4\n",
		"#EXTM3U\n#EXTINF:1.0000001,\nsegment.mp4\n",
		"#EXTM3U\n#EXTINF:1,\n",
		"#EXTM3U\n#EXTINF:1,\nsegment.mp4\n#EXTINF:2,\nsegment.mp4\n",
	}
	for _, playlist := range tests {
		if segments, err := ParseFinalizedHLSSegmentsV1(strings.NewReader(playlist)); err == nil {
			t.Fatalf("accepted malformed playlist %q as %+v", playlist, segments)
		}
	}
}
