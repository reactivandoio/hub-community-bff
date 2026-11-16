---
symptom: "Contagem sempre 0 (\"E-mails (0)\") ou paginação que para na primeira página, com a lista vindo cheia"
tags: [strapi, paginacao, meta, datasource]
evidence: fixed
card: REA-52
agent: claude
date: 2026-11-16
---
## Causa

O `fetch` compartilhado dos data sources (`src/utils/network/strapi/helpers.js`, `createStrapiFetch`)
devolve `{ data, meta }` com `meta` **já sendo** o objeto `pagination` do Strapi
(`response.data.meta.pagination`). Quem lê `response.meta.pagination.total` ou
`response.meta.pagination.pageCount` recebe `undefined`: o total vira 0 e o laço de páginas acha que só
existe uma. Os testes com o data source simulado não pegavam porque o mock devolvia o formato cru do
Strapi.

## Correção

Ler `response.meta.total` e `response.meta.pageCount` (como já fazem `countEmailDeliveriesSince` e
`findRoleChanges`). Nos testes de data source, simular o `fetch` com `meta` já achatado:
`{ data, meta: { page, pageSize, pageCount, total } }`.

## Como conferir

`npx vitest run src/dataSources/manager-integration/email-campaigns` e, no admin, a aba
"E-mails (N)" do perfil do usuário com N igual ao número de e-mails da lista.
