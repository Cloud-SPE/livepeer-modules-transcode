package liverunner

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"

	transcode "github.com/Cloud-SPE/livepeer-modules-transcode/transcode-core"
)

type LiveRunnerConfigV1 struct {
	ListenAddress    string
	StateDirectory   string
	MasterKey        []byte
	BrokerToken      string
	InternalToken    string
	PublicRTMPURL    string
	PublicHLSBase    string
	PublicAPIBase    string
	PresetsFile      string
	MediaMTXBinary   string
	MediaMTXConfig   string
	MediaMTX         MediaMTXConfigV1
	RouterRTMPBase   string
	MaxConcurrent    int
	StartupTimeout   time.Duration
	ShutdownTimeout  time.Duration
	RouterPoll       time.Duration
	MeterPoll        time.Duration
	HeartbeatEvery   time.Duration
	CallbackPoll     time.Duration
	RequestTimeout   time.Duration
	HLSHeaderTimeout time.Duration
	GrantTTL         time.Duration
	StreamKeyTTL     time.Duration
}

func LoadLiveRunnerConfigV1(getenv func(string) string) (LiveRunnerConfigV1, error) {
	if getenv == nil {
		getenv = os.Getenv
	}
	required := func(name string) (string, error) {
		value := getenv(name)
		if value == "" {
			return "", fmt.Errorf("%s is required", name)
		}
		return value, nil
	}
	masterEncoded, err := required("LIVE_RUNNER_MASTER_KEY")
	if err != nil {
		return LiveRunnerConfigV1{}, err
	}
	masterKey, err := base64.StdEncoding.DecodeString(masterEncoded)
	if err != nil || len(masterKey) != 32 {
		return LiveRunnerConfigV1{}, errors.New("LIVE_RUNNER_MASTER_KEY must be base64 for exactly 32 bytes")
	}
	brokerToken, err := required("LIVE_RUNNER_BROKER_TOKEN")
	if err != nil || len(brokerToken) < 32 {
		return LiveRunnerConfigV1{}, errors.New("LIVE_RUNNER_BROKER_TOKEN must contain at least 32 characters")
	}
	internalToken, err := required("LIVE_RUNNER_INTERNAL_MEDIA_TOKEN")
	if err != nil || len(internalToken) < 32 {
		return LiveRunnerConfigV1{}, errors.New("LIVE_RUNNER_INTERNAL_MEDIA_TOKEN must contain at least 32 characters")
	}
	publicRTMP, err := required("LIVE_RUNNER_PUBLIC_RTMP_URL")
	if err != nil {
		return LiveRunnerConfigV1{}, err
	}
	publicHLS, err := required("LIVE_RUNNER_PUBLIC_HLS_BASE")
	if err != nil {
		return LiveRunnerConfigV1{}, err
	}
	publicAPI, err := required("LIVE_RUNNER_PUBLIC_API_BASE")
	if err != nil {
		return LiveRunnerConfigV1{}, err
	}
	presetsFile, err := required("LIVE_RUNNER_PRESETS_FILE")
	if err != nil {
		return LiveRunnerConfigV1{}, err
	}
	integer := func(name string, fallback int) (int, error) {
		value := getenv(name)
		if value == "" {
			return fallback, nil
		}
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 0 {
			return 0, fmt.Errorf("%s must be a non-negative integer", name)
		}
		return parsed, nil
	}
	maxConcurrent, err := integer("LIVE_RUNNER_MAX_CONCURRENT", 0)
	if err != nil {
		return LiveRunnerConfigV1{}, err
	}
	config := LiveRunnerConfigV1{
		ListenAddress:  valueOrV1(getenv("LIVE_RUNNER_ADDR"), ":8080"),
		StateDirectory: valueOrV1(getenv("LIVE_RUNNER_STATE_DIR"), "/var/lib/live-runner"),
		MasterKey:      masterKey, BrokerToken: brokerToken, InternalToken: internalToken,
		PublicRTMPURL: publicRTMP, PublicHLSBase: publicHLS, PublicAPIBase: publicAPI, PresetsFile: presetsFile,
		MediaMTXBinary: valueOrV1(getenv("LIVE_RUNNER_MEDIAMTX_BINARY"), "/usr/local/bin/mediamtx"),
		RouterRTMPBase: valueOrV1(getenv("LIVE_RUNNER_ROUTER_RTMP_BASE"), "rtmp://127.0.0.1:1935"),
		MaxConcurrent:  maxConcurrent, StartupTimeout: 30 * time.Second, ShutdownTimeout: 30 * time.Second,
		RouterPoll: 100 * time.Millisecond, MeterPoll: 250 * time.Millisecond, HeartbeatEvery: 4 * time.Second, CallbackPoll: 250 * time.Millisecond,
		RequestTimeout: 2 * time.Second, GrantTTL: time.Hour, StreamKeyTTL: 10 * time.Minute,
		HLSHeaderTimeout: 15 * time.Second,
	}
	config.MediaMTXConfig = config.StateDirectory + "/mediamtx.yml"
	config.MediaMTX = DefaultMediaMTXConfigV1(valueOrV1(getenv("LIVE_RUNNER_MEDIAMTX_AUTH_URL"), "http://127.0.0.1:8080/internal/mediamtx/auth"))
	config.MediaMTX.RTMPAddress = valueOrV1(getenv("LIVE_RUNNER_MEDIAMTX_RTMP_ADDR"), config.MediaMTX.RTMPAddress)
	config.MediaMTX.HLSAddress = valueOrV1(getenv("LIVE_RUNNER_MEDIAMTX_HLS_ADDR"), config.MediaMTX.HLSAddress)
	config.MediaMTX.APIAddress = valueOrV1(getenv("LIVE_RUNNER_MEDIAMTX_API_ADDR"), config.MediaMTX.APIAddress)
	config.MediaMTX.MetricsAddress = valueOrV1(getenv("LIVE_RUNNER_MEDIAMTX_METRICS_ADDR"), config.MediaMTX.MetricsAddress)
	return config, nil
}

func RunLiveRunnerV1(ctx context.Context, config LiveRunnerConfigV1) error {
	presetBody, err := os.ReadFile(config.PresetsFile)
	if err != nil {
		return errors.New("read live presets failed")
	}
	presets, err := transcode.LoadABRPresetsFromBytes(presetBody)
	if err != nil {
		return errors.New("parse live presets failed")
	}
	hardware := transcode.DetectGPU()
	store, err := NewEncryptedFileSessionStoreV1(config.StateDirectory+"/sessions", config.MasterKey)
	if err != nil {
		return err
	}
	router, err := NewMediaRouterClientV1("http://"+config.MediaMTX.APIAddress, nil, config.RequestTimeout)
	if err != nil {
		return err
	}
	hls, err := NewHLSHandlerV1(store, presets, "http://"+config.MediaMTX.HLSAddress, nil, config.HLSHeaderTimeout)
	if err != nil {
		return err
	}
	meter, err := NewLiveOutputMeterV1(store, hls, config.MeterPoll, config.HeartbeatEvery, config.RequestTimeout)
	if err != nil {
		return err
	}
	dispatcher, err := NewCallbackDispatcherV1(store, nil, config.RequestTimeout)
	if err != nil {
		return err
	}
	callbackWorker, err := NewCallbackWorkerV1(store, dispatcher, config.CallbackPoll)
	if err != nil {
		return err
	}
	runtime, err := NewLiveRuntimeCoordinatorV1(store, router, FFmpegLiveLadderLauncherV1{}, meter, presets, hardware, config.RouterRTMPBase, config.InternalToken, config.RouterPoll, config.MaxConcurrent)
	if err != nil {
		return err
	}
	supervisor, err := NewMediaMTXSupervisorV1(config.MediaMTXBinary, config.MediaMTXConfig, config.MediaMTX, config.RequestTimeout, config.RouterPoll)
	if err != nil {
		return err
	}
	startup, cancelStartup := context.WithTimeout(ctx, config.StartupTimeout)
	err = supervisor.Start(startup)
	cancelStartup()
	if err != nil {
		return err
	}
	defer func() {
		shutdown, cancel := context.WithTimeout(context.Background(), config.ShutdownTimeout)
		_ = supervisor.Stop(shutdown)
		cancel()
	}()
	if err := RecoverLiveSessionsV1(ctx, store, runtime, time.Now); err != nil {
		return err
	}
	callbackContext, cancelCallbacks := context.WithCancel(ctx)
	callbackExit := make(chan error, 1)
	go func() { callbackExit <- callbackWorker.Run(callbackContext) }()
	factory := RunnerResponseFactoryV1{PublicRTMPURL: config.PublicRTMPURL, PublicHLSBase: config.PublicHLSBase, PublicAPIBase: config.PublicAPIBase, GrantTTL: config.GrantTTL}
	if err := factory.Validate(); err != nil {
		cancelCallbacks()
		<-callbackExit
		return err
	}
	serverDefinition := &LiveRunnerServerV1{Store: store, Runtime: runtime, Factory: factory, BrokerToken: config.BrokerToken, KeyTTL: config.StreamKeyTTL, Ready: supervisor.Ready, HLS: hls}
	handler, err := serverDefinition.Handler(MediaMTXAuthorizerV1{Sessions: store, InternalTokenRoot: config.InternalToken})
	if err != nil {
		cancelCallbacks()
		<-callbackExit
		return err
	}
	httpServer := &http.Server{Addr: config.ListenAddress, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second}
	httpExit := make(chan error, 1)
	go func() {
		err := httpServer.ListenAndServe()
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		httpExit <- err
	}()
	var runErr error
	callbackStopped := false
	select {
	case <-ctx.Done():
	case <-supervisor.Done():
		runErr = ErrMediaRouterExitedV1
	case runErr = <-callbackExit:
		callbackStopped = true
	case runErr = <-httpExit:
	}
	shutdown, cancelShutdown := context.WithTimeout(context.Background(), config.ShutdownTimeout)
	defer cancelShutdown()
	cancelCallbacks()
	serverErr := httpServer.Shutdown(shutdown)
	runtimeErr := runtime.Shutdown(shutdown)
	var callbackErr error
	if !callbackStopped {
		select {
		case callbackErr = <-callbackExit:
		case <-shutdown.Done():
			callbackErr = shutdown.Err()
		}
	}
	mediaErr := supervisor.Stop(shutdown)
	return errors.Join(runErr, serverErr, runtimeErr, callbackErr, mediaErr)
}

func valueOrV1(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
