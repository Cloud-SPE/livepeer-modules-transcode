.PHONY: build test test-container race vet fmt image image-test image-smoke

HARDWARE ?= cpu
IMAGE ?= tztcloud/live-runner-$(HARDWARE)
TAG ?= dev

build:
	go build ./cmd/live-runner

test:
	go test ./...

test-container:
	LIVE_RUNNER_CONTAINER_TEST=1 go test -run 'Test(MediaMTX(ImageAcceptsGeneratedConfig|RealPublisherCanBeKicked)|LiveHLSRealMediaMTXPlaylistIsPubliclyReachable)' ./...

image-test:
	docker build --target go-test -f Dockerfile ..

image:
	docker build --target runtime-$(HARDWARE) -t $(IMAGE):$(TAG) -f Dockerfile ..

image-smoke: image
	./scripts/image-smoke.sh $(IMAGE):$(TAG) $(HARDWARE)

race:
	go test -race ./...

vet:
	go vet ./...

fmt:
	gofmt -w *.go
