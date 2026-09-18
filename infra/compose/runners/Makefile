COMPOSE_FILE ?= compose.yaml
ENV_FILE     ?= $(if $(wildcard .env),.env,.env.example)
PROFILE      ?= vod-nvidia

PROFILES := \
	vod-nvidia vod-intel vod-amd vod-cpu \
	abr-nvidia abr-intel abr-amd \
	live-nvidia live-intel live-amd live-cpu

.PHONY: validate config up down logs

validate: ## Validate the fully interpolated Compose model for every profile.
	@set -eu; \
	for profile in $(PROFILES); do \
		docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE) --profile $$profile config --quiet; \
		printf 'validated %s\n' $$profile; \
	done

config: ## Render one profile (PROFILE=vod-nvidia by default).
	docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE) --profile $(PROFILE) config

up: ## Start one profile (for example: make up PROFILE=abr-intel).
	docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE) --profile $(PROFILE) up -d

down: ## Stop the selected profile without deleting its named state volume.
	docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE) --profile $(PROFILE) down

logs: ## Follow logs for the selected profile.
	docker compose --env-file $(ENV_FILE) -f $(COMPOSE_FILE) --profile $(PROFILE) logs --follow
