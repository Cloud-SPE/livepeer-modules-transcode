.PHONY: help build test vet fmt image clean

REGISTRY ?= tztcloud
IMAGE   ?= $(REGISTRY)/transcode-runner
TAG     ?= v0.1.0
TARGET  ?= runtime-nvidia
CODECS_IMAGE ?= $(REGISTRY)/codecs-builder:$(TAG)
REVISION := $(shell git rev-parse HEAD)
VERSION := $(shell VERSION_PREFIX=$(TAG) ../infra/build/git-version.sh)

help: ## Show this help.
	@grep -E '^[a-zA-Z_-]+:.*?## ' Makefile | awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-8s\033[0m %s\n", $$1, $$2}'

build: ## go build .
	go build .

test: ## go test ./... (no unit tests in this binary; integration via transcode-tester)
	go test ./...

vet: ## go vet ./...
	go vet ./...

fmt: ## gofmt -l -w .
	gofmt -l -w .

image: ## docker build (TARGET=runtime-nvidia|runtime-intel|runtime-amd, TAG=...)
	docker build --target $(TARGET) -t $(IMAGE):$(TAG)-$(TARGET) \
		--build-arg CODECS_IMAGE="$(CODECS_IMAGE)" \
		--label org.opencontainers.image.source=https://github.com/Cloud-SPE/livepeer-modules-transcode \
		--label org.opencontainers.image.revision="$(REVISION)" \
		--label org.opencontainers.image.version="$(VERSION)" -f Dockerfile ..

clean: ## remove build artifacts
	go clean ./...
	rm -f transcode-runner
