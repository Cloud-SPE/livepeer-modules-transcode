package liverunner

import (
	"context"
	"errors"
	"io"
	"net/url"
	"os/exec"
	"strings"
	"sync"
	"time"

	transcode "github.com/Cloud-SPE/livepeer-modules-transcode/transcode-core"
)

type MediaPublisherWaiterV1 interface {
	WaitForRTMPPublisher(context.Context, string, time.Duration) (MediaPathStatusV1, error)
	KickPublisher(context.Context, string) error
}

type LiveLadderProcessV1 interface {
	Wait() error
}

type LiveLadderLauncherV1 interface {
	Start(context.Context, string, []transcode.LiveRTMPOutput, transcode.HWProfile, transcode.ProbeResult) (LiveLadderProcessV1, error)
}

type LiveSessionMeterV1 interface {
	Run(context.Context, SessionRecordV1, SessionSecretsV1)
}

type FFmpegLiveLadderLauncherV1 struct{}

func (l FFmpegLiveLadderLauncherV1) Start(ctx context.Context, inputURL string, outputs []transcode.LiveRTMPOutput, hardware transcode.HWProfile, probe transcode.ProbeResult) (LiveLadderProcessV1, error) {
	command, err := transcode.LiveLadderCmdContext(ctx, inputURL, outputs, hardware, probe)
	if err != nil {
		return nil, err
	}
	command.Stdout = io.Discard
	// FFmpeg can include credential-bearing RTMP URLs in diagnostics. Runtime
	// health is reported through safe event codes, never raw process output.
	command.Stderr = io.Discard
	if err := command.Start(); err != nil {
		return nil, err
	}
	return &execLiveLadderProcessV1{command: command}, nil
}

type execLiveLadderProcessV1 struct {
	command *exec.Cmd
}

func (p *execLiveLadderProcessV1) Wait() error { return p.command.Wait() }

type activeLiveSessionV1 struct {
	cancel context.CancelFunc
	done   chan struct{}
}

type LiveRuntimeCoordinatorV1 struct {
	store             *EncryptedFileSessionStoreV1
	router            MediaPublisherWaiterV1
	launcher          LiveLadderLauncherV1
	meter             LiveSessionMeterV1
	presets           map[string]transcode.ABRPreset
	hardware          transcode.HWProfile
	routerRTMPBase    string
	internalTokenRoot string
	pollInterval      time.Duration
	capacity          chan struct{}

	mu       sync.Mutex
	sessions map[string]*activeLiveSessionV1
}

func NewLiveRuntimeCoordinatorV1(store *EncryptedFileSessionStoreV1, router MediaPublisherWaiterV1, launcher LiveLadderLauncherV1, meter LiveSessionMeterV1, presets []transcode.ABRPreset, hardware transcode.HWProfile, routerRTMPBase, internalTokenRoot string, pollInterval time.Duration, maxConcurrent int) (*LiveRuntimeCoordinatorV1, error) {
	if store == nil || router == nil || launcher == nil || meter == nil || len(presets) == 0 || len(internalTokenRoot) < 32 || pollInterval <= 0 || maxConcurrent < 0 {
		return nil, errors.New("live runtime dependencies are incomplete")
	}
	parsed, err := url.Parse(routerRTMPBase)
	if err != nil || parsed.Scheme != "rtmp" || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("internal media router RTMP base is invalid")
	}
	byName := make(map[string]transcode.ABRPreset, len(presets))
	for _, preset := range presets {
		key := strings.ToLower(preset.Name)
		if key == "" || len(preset.Renditions) == 0 || preset.SegmentDuration <= 0 || preset.SegmentDuration > 10 {
			return nil, errors.New("live runtime preset is invalid")
		}
		if _, duplicate := byName[key]; duplicate {
			return nil, errors.New("live runtime preset names must be unique")
		}
		byName[key] = preset
	}
	var capacity chan struct{}
	if maxConcurrent > 0 {
		capacity = make(chan struct{}, maxConcurrent)
	}
	return &LiveRuntimeCoordinatorV1{
		store: store, router: router, launcher: launcher, meter: meter, presets: byName, hardware: hardware,
		routerRTMPBase: strings.TrimRight(routerRTMPBase, "/"), internalTokenRoot: internalTokenRoot,
		pollInterval: pollInterval, capacity: capacity, sessions: make(map[string]*activeLiveSessionV1),
	}, nil
}

func (c *LiveRuntimeCoordinatorV1) ValidateSession(request RunnerCreateRequestV1) error {
	preset, ok := c.presets[strings.ToLower(request.SessionParams.OutputProfile)]
	if !ok {
		return errors.New("unknown live output profile")
	}
	meteringFound := false
	for _, rendition := range preset.Renditions {
		if rendition.Name == request.SessionParams.MeteringRendition {
			meteringFound = true
		}
		if rendition.Video != nil && !strings.EqualFold(rendition.Video.Codec, "h264") && !strings.EqualFold(rendition.Video.Codec, "avc") {
			return errors.New("live output profile contains a non-H264 rendition")
		}
		if !strings.EqualFold(rendition.Audio.Codec, "aac") {
			return errors.New("live output profile contains a non-AAC rendition")
		}
	}
	if !meteringFound {
		return errors.New("metering rendition is not in the live output profile")
	}
	return nil
}

func (c *LiveRuntimeCoordinatorV1) EnsureSession(_ context.Context, record SessionRecordV1, secrets SessionSecretsV1) error {
	if record.State != "active" || record.Stopping {
		return ErrSessionTerminalV1
	}
	if err := c.ValidateSession(secrets.CreateRequest); err != nil {
		return err
	}
	c.mu.Lock()
	if _, exists := c.sessions[record.RunnerSessionID]; exists {
		c.mu.Unlock()
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	active := &activeLiveSessionV1{cancel: cancel, done: make(chan struct{})}
	c.sessions[record.RunnerSessionID] = active
	c.mu.Unlock()
	if record.LastSequence == 0 {
		event := RunnerEventV1{
			EventID: record.RunnerSessionID + ":1", Sequence: 1, EventType: "session.started",
			EventTime: time.Now().UTC().Format(time.RFC3339Nano), State: "active", Details: []byte(`{}`),
		}
		if err := c.store.Advance(record.BrokerSessionID, event); err != nil {
			cancel()
			c.remove(record.RunnerSessionID, active)
			return err
		}
	}
	go c.run(ctx, active, record, secrets)
	return nil
}

func (c *LiveRuntimeCoordinatorV1) TerminateSession(ctx context.Context, record SessionRecordV1) error {
	ingestPath, err := IngestMediaPathV1(record.RunnerSessionID)
	if err != nil {
		return err
	}
	c.mu.Lock()
	active := c.sessions[record.RunnerSessionID]
	c.mu.Unlock()
	if active != nil {
		active.cancel()
	}
	kickErr := c.router.KickPublisher(ctx, ingestPath)
	if active == nil {
		return kickErr
	}
	select {
	case <-active.done:
		return kickErr
	case <-ctx.Done():
		return errors.Join(kickErr, ctx.Err())
	}
}

func (c *LiveRuntimeCoordinatorV1) ActivateStreamKey(ctx context.Context, record SessionRecordV1) error {
	ingestPath, err := IngestMediaPathV1(record.RunnerSessionID)
	if err != nil {
		return err
	}
	return c.router.KickPublisher(ctx, ingestPath)
}

func (c *LiveRuntimeCoordinatorV1) Shutdown(ctx context.Context) error {
	c.mu.Lock()
	active := make([]*activeLiveSessionV1, 0, len(c.sessions))
	for _, session := range c.sessions {
		session.cancel()
		active = append(active, session)
	}
	c.mu.Unlock()
	for _, session := range active {
		select {
		case <-session.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

func (c *LiveRuntimeCoordinatorV1) run(ctx context.Context, active *activeLiveSessionV1, record SessionRecordV1, secrets SessionSecretsV1) {
	defer close(active.done)
	defer c.remove(record.RunnerSessionID, active)
	runContext, cancel := context.WithCancel(ctx)
	meterDone := make(chan struct{})
	go func() {
		defer close(meterDone)
		c.meter.Run(runContext, record, secrets)
	}()
	defer func() {
		cancel()
		<-meterDone
	}()
	ingestPath, _ := IngestMediaPathV1(record.RunnerSessionID)
	preset := c.presets[strings.ToLower(secrets.CreateRequest.SessionParams.OutputProfile)]
	internalToken := InternalMediaTokenV1(c.internalTokenRoot, record.RunnerSessionID)
	inputURL := c.routerRTMPBase + "/" + ingestPath + "?token=" + url.QueryEscape(internalToken)
	outputs := make([]transcode.LiveRTMPOutput, 0, len(preset.Renditions))
	for _, rendition := range preset.Renditions {
		outputPath, _ := RenditionMediaPathV1(record.RunnerSessionID, rendition.Name)
		outputs = append(outputs, transcode.LiveRTMPOutput{Rendition: rendition, URL: c.routerRTMPBase + "/" + outputPath + "?token=" + url.QueryEscape(internalToken), KeyframeInterval: time.Duration(preset.SegmentDuration) * time.Second})
	}
	for {
		if _, err := c.router.WaitForRTMPPublisher(runContext, ingestPath, c.pollInterval); err != nil {
			return
		}
		if !c.acquire(runContext) {
			return
		}
		process, err := c.launcher.Start(runContext, inputURL, outputs, c.hardware, transcode.ProbeResult{})
		if err == nil {
			_ = process.Wait()
		}
		c.release()
		if runContext.Err() != nil {
			return
		}
		timer := time.NewTimer(c.pollInterval)
		select {
		case <-runContext.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (c *LiveRuntimeCoordinatorV1) acquire(ctx context.Context) bool {
	if c.capacity == nil {
		return true
	}
	select {
	case c.capacity <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}

func (c *LiveRuntimeCoordinatorV1) release() {
	if c.capacity != nil {
		<-c.capacity
	}
}

func (c *LiveRuntimeCoordinatorV1) remove(id string, active *activeLiveSessionV1) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sessions[id] == active {
		delete(c.sessions, id)
	}
}
