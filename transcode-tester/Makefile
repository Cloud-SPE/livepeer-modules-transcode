.PHONY: help build run-transcode run-abr presets clean

IMAGE ?= tztcloud/transcode-tester
TAG   ?= v0.1.0

help: ## Show this help.
	@grep -E '^[a-zA-Z_-]+:.*?## ' Makefile | awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

build: ## docker build .
	docker build -t $(IMAGE):$(TAG) .

run-transcode: ## docker run; submits a single-rendition job (set OPENAI_BASE_URL)
	docker run --rm --network host -e OPENAI_BASE_URL=$$OPENAI_BASE_URL $(IMAGE):$(TAG)

run-abr: ## docker run; submits an ABR ladder job
	docker run --rm --network host -e OPENAI_BASE_URL=$$OPENAI_BASE_URL $(IMAGE):$(TAG) node test-abr.mjs quick

presets: ## list runner presets (single-rendition)
	docker run --rm --network host -e OPENAI_BASE_URL=$$OPENAI_BASE_URL $(IMAGE):$(TAG) node test-transcode.mjs presets

clean: ## remove dangling images
	docker image prune -f
