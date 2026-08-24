package liverunner

import (
	"bufio"
	"errors"
	"io"
	"strconv"
	"strings"
)

const maxMediaPlaylistBytesV1 = 1 << 20

// FinalizedHLSSegmentV1 is a complete media segment advertised with EXTINF.
// Low-latency parts are intentionally absent: they are provisional and must
// never advance output_seconds.
type FinalizedHLSSegmentV1 struct {
	URI                  string
	DurationMicroseconds uint64
}

// ParseFinalizedHLSSegmentsV1 extracts only complete EXTINF/URI pairs from a
// media playlist. The URI is retained as the segment's stable identity across
// playlist rereads; MediaMTX gives newly finalized segments unique names.
func ParseFinalizedHLSSegmentsV1(reader io.Reader) ([]FinalizedHLSSegmentV1, error) {
	limited := io.LimitReader(reader, maxMediaPlaylistBytesV1+1)
	scanner := bufio.NewScanner(limited)
	scanner.Buffer(make([]byte, 4096), maxMediaPlaylistBytesV1+1)
	lineNumber := 0
	mediaPlaylist := false
	pendingDuration := uint64(0)
	hasPendingDuration := false
	seen := make(map[string]FinalizedHLSSegmentV1)
	var segments []FinalizedHLSSegmentV1
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if lineNumber == 1 {
			line = strings.TrimPrefix(line, "\ufeff")
			if line != "#EXTM3U" {
				return nil, errors.New("HLS playlist header is invalid")
			}
			continue
		}
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "#EXTINF:") {
			if hasPendingDuration {
				return nil, errors.New("HLS segment duration has no URI")
			}
			raw := strings.TrimPrefix(line, "#EXTINF:")
			if comma := strings.IndexByte(raw, ','); comma >= 0 {
				raw = raw[:comma]
			}
			duration, err := parseHLSMicrosecondsV1(raw)
			if err != nil {
				return nil, err
			}
			mediaPlaylist = true
			pendingDuration, hasPendingDuration = duration, true
			continue
		}
		if strings.HasPrefix(line, "#") {
			continue
		}
		if !hasPendingDuration {
			continue
		}
		if len(line) > 2048 || strings.ContainsAny(line, "\x00\r\n") {
			return nil, errors.New("HLS segment URI is invalid")
		}
		segment := FinalizedHLSSegmentV1{URI: line, DurationMicroseconds: pendingDuration}
		if previous, ok := seen[line]; ok {
			if previous.DurationMicroseconds != pendingDuration {
				return nil, errors.New("HLS segment URI has conflicting durations")
			}
		} else {
			seen[line] = segment
			segments = append(segments, segment)
		}
		hasPendingDuration = false
	}
	if err := scanner.Err(); err != nil {
		return nil, errors.New("HLS playlist exceeds the size limit")
	}
	if lineNumber == 0 || !mediaPlaylist {
		return nil, errors.New("HLS media playlist has no finalized segments")
	}
	if hasPendingDuration {
		return nil, errors.New("HLS segment duration has no URI")
	}
	return segments, nil
}

func parseHLSMicrosecondsV1(raw string) (uint64, error) {
	if raw == "" || strings.TrimSpace(raw) != raw || strings.HasPrefix(raw, "-") || strings.HasPrefix(raw, "+") {
		return 0, errors.New("HLS segment duration is invalid")
	}
	parts := strings.Split(raw, ".")
	if len(parts) > 2 || parts[0] == "" || (len(parts) == 2 && (parts[1] == "" || len(parts[1]) > 6)) {
		return 0, errors.New("HLS segment duration is invalid")
	}
	seconds, err := strconv.ParseUint(parts[0], 10, 58)
	if err != nil {
		return 0, errors.New("HLS segment duration is invalid")
	}
	fraction := uint64(0)
	if len(parts) == 2 {
		fraction, err = strconv.ParseUint(parts[1]+strings.Repeat("0", 6-len(parts[1])), 10, 64)
		if err != nil {
			return 0, errors.New("HLS segment duration is invalid")
		}
	}
	duration := seconds*1_000_000 + fraction
	if duration == 0 {
		return 0, errors.New("HLS segment duration is invalid")
	}
	return duration, nil
}
