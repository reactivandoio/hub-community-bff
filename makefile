start:
	yarn clean
	yarn
	yarn build
	pm2 start yarn --name hub-community-bff -- run start

update:
	git pull
	yarn clean
	yarn
	yarn build
	pm2 restart hub-community-bff

# ---------------------------------------------------------------------------------------------
# Desenvolvimento em Docker (REA-21): só precisa do Docker na máquina. start e update, acima,
# são do deploy de produção (pm2 no servidor) e não usam nada daqui.
#   make dev     sobe o BFF em http://localhost:4001/graphql com recarga de código
#   make test    testes como no CI          make build   build como no CI
#   make lint    lint como no CI            make shell   terminal dentro do container
#   make down    para tudo                  make reset   para e apaga os volumes (node_modules)
# ---------------------------------------------------------------------------------------------
DEV_COMPOSE = BFF_NODE_VERSION=$$(cat .nvmrc) BFF_GIT_DIR=$$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo $$PWD/.git) \
	DEV_UID=$$(id -u) DEV_GID=$$(id -g) \
	docker compose -f docker-compose.dev.yml --env-file .env.dev
DEV_RUN = $(DEV_COMPOSE) run --rm --build --no-deps bff sh -c
DEV_INSTALL = yarn install --frozen-lockfile --network-timeout 600000 --silent

.PHONY: dev down reset logs shell test build lint dev-setup

dev-setup:
	@test -f .env.dev || { cp .env.dev.example .env.dev && echo "Criei o .env.dev a partir do .env.dev.example."; }
	@touch .env
	@mkdir -p node_modules

dev: dev-setup
	$(DEV_COMPOSE) up --build

down: dev-setup
	$(DEV_COMPOSE) down

reset: dev-setup
	$(DEV_COMPOSE) down -v

logs: dev-setup
	$(DEV_COMPOSE) logs -f

shell: dev-setup
	$(DEV_COMPOSE) run --rm --build --no-deps bff bash

test: dev-setup
	$(DEV_RUN) '$(DEV_INSTALL) && yarn test && bash .github/scripts/env-scripts.test.sh'

build: dev-setup
	$(DEV_RUN) '$(DEV_INSTALL) && yarn build'

lint: dev-setup
	$(DEV_RUN) '$(DEV_INSTALL) && yarn eslint src'
