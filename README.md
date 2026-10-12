# hub-community-bff

GraphQL (Apollo Server) entre o frontend do Hub Community, o Strapi do Hub
(hub-community-backend) e o Eventando (eventando-manager).

## Desenvolvimento em Docker

Só precisa do Docker (macOS ou Linux). A versão do Node fica no `.nvmrc`, a mesma do CI e da produção.

```bash
make dev     # sobe o BFF em http://localhost:4001/graphql, com recarga de código
make test    # testes, como no CI
make build   # build, como no CI
make lint    # lint, como no CI (lá ele não bloqueia)
make shell   # terminal dentro do container
make down    # para; make reset também apaga os volumes (node_modules)
```

Na primeira vez, o `make` cria o `.env.dev` a partir do `.env.dev.example` (o `.env.dev` fica fora
do git). Dentro do container o `.env` é o `.env.dev`: o `.env` da máquina nunca é lido.

Para onde o BFF aponta fica no `.env.dev`:

- **Serviços locais** (padrão): rode `make dev` no hub-community-backend (porta 1340) e no
  eventando-manager (porta 1341), crie um API Token "Full access" no admin de cada um e cole em
  `MANAGER_TOKEN_INTEGRATION` e `EVENTANDO_MANAGER_TOKEN_INTEGRATION`.
- **Produção**: troque as URLs pelas comentadas no arquivo e use tokens de produção (nunca no git).

A stack inteira (MySQL, Strapi, Eventando, BFF e frontend) sobe de uma vez com `make hub` no
hub-community-frontend.

O deploy de produção não usa nada disso: continua com `make update` (pm2) no servidor.
