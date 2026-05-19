.PHONY: help up smoke smoke-daemon logs down reset

COMPOSE ?= docker compose -f compose.yaml

help: ## Show this help.
	@grep -E '^[a-zA-Z_-]+:.*?## ' Makefile | awk 'BEGIN {FS = ":.*?## "} {printf "  \033[36m%-8s\033[0m %s\n", $$1, $$2}'

up: ## docker compose up -d --build
	$(COMPOSE) up -d --build

smoke: up ## bring up the stack and run the smoke
	@chmod +x smoke.sh
	@COMPOSE='$(COMPOSE)' ./smoke.sh

smoke-daemon: ## bring up the daemon-backed stack and run the real-wire smoke
	@chmod +x smoke-daemon.sh
	@COMPOSE='docker compose -f compose.daemon.yaml' ./smoke-daemon.sh

logs: ## follow gateway logs
	$(COMPOSE) logs -f gateway

down: ## docker compose down -v (drops volumes too)
	$(COMPOSE) down -v

reset: down up ## down + up (fresh state)
