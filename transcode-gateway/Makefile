.PHONY: help build smoke shell migrate clean

IMAGE       ?= tztcloud/transcode-gateway
TAG         ?= v0.1.0
COMPOSE     ?= docker compose -f compose.yaml

help: ## Show this help.
	@grep -E '^[a-zA-Z_-]+:.*?## ' Makefile | awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

build: ## Build the gateway image.
	docker build -f Dockerfile -t $(IMAGE):$(TAG) ..

smoke: ## Bring up the compose stack and run the smoke test.
	$(COMPOSE) up -d --build
	@./scripts/smoke.sh

migrate: ## Run migrations against the compose postgres.
	$(COMPOSE) exec gateway node dist/index.js --migrate-only

shell: ## Interactive shell into the running gateway container.
	$(COMPOSE) exec gateway sh

clean: ## Tear down the compose stack and remove built artifacts.
	$(COMPOSE) down -v
	rm -rf dist dist-test
