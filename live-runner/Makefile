.PHONY: build test test-container race vet fmt image image-test image-smoke

IMAGE ?= tztcloud/live-runner
TAG ?= dev

build:
	go build ./cmd/live-runner

test:
	go test ./...

test-container:
	LIVE_RUNNER_CONTAINER_TEST=1 go test -run 'TestMediaMTX(ImageAcceptsGeneratedConfig|RealPublisherCanBeKicked)' ./...

image-test:
	docker build --target go-test -f Dockerfile ..

image:
	docker build --target runtime -t $(IMAGE):$(TAG) -f Dockerfile ..

image-smoke: image
	./scripts/image-smoke.sh $(IMAGE):$(TAG)

race:
	go test -race ./...

vet:
	go vet ./...

fmt:
	gofmt -w *.go
