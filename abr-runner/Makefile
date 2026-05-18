.PHONY: help build test vet fmt image clean

IMAGE   ?= tztcloud/abr-runner
TAG     ?= v0.1.0
TARGET  ?= runtime-nvidia

help: ## Show this help.
	@grep -E '^[a-zA-Z_-]+:.*?## ' Makefile | awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-8s\033[0m %s\n", $$1, $$2}'

build: ## go build .
	go build .

test: ## go test ./... (integration via transcode-tester)
	go test ./...

vet: ## go vet ./...
	go vet ./...

fmt: ## gofmt -l -w .
	gofmt -l -w .

image: ## docker build (TARGET=runtime-nvidia|runtime-intel|runtime-amd, TAG=...)
	docker build --target $(TARGET) -t $(IMAGE):$(TAG)-$(TARGET) -f Dockerfile ..

clean: ## remove build artifacts
	go clean ./...
	rm -f abr-runner
