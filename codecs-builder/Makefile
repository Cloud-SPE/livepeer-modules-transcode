.PHONY: help build push clean

IMAGE ?= tztcloud/codecs-builder
TAG   ?= v0.1.0

help: ## Show this help.
	@grep -E '^[a-zA-Z_-]+:.*?## ' Makefile | awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-8s\033[0m %s\n", $$1, $$2}'

build: ## docker build (takes 20+ minutes; compiles ffmpeg deps from source)
	docker build -t $(IMAGE):$(TAG) .

push: ## docker push the built image
	docker push $(IMAGE):$(TAG)

clean: ## remove dangling images (does NOT remove $(IMAGE):$(TAG))
	docker image prune -f
