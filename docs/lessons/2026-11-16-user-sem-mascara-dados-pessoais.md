---
symptom: "communityBySlugOrId { organizers { email phone cpf date_of_birth } } devolve os dados a quem não está logado"
tags: [seguranca, lgpd, graphql, user, certificado, filtros]
evidence: fixed
card: REA-56
agent: claude
date: 2026-11-16
---
## Causa

O tipo `User` não tinha resolvers para os campos pessoais: o objeto do Strapi saía inteiro por
qualquer caminho que devolve `User` (organizadores, autores de comentário, `userByUsername`). Como o
BFF lê com o token de integração, o Strapi devolve tudo e só o BFF pode filtrar. Na mesma varredura:
`lookupCertificate`/`requestCertificate` devolviam o e-mail e o CPF do certificado de quem tivesse o
CPF digitado; `communities` e `comments` repassavam filtros por `email` (dava para adivinhar letra a
letra com `startsWith`); `comments` aceitava qualquer `populate`. E `users`/`user`/`userByUsername`
liam sem token, dependendo do `user.find` do papel Public do Strapi (que era o vazamento lá).

## Correção

- `resolvers/User/personal-data.js`: `email`, `phone`, `cpf`, `date_of_birth`, `adult_declaration*` e
  `token` só para a própria pessoa (mesmo id), para o resultado do próprio login (traz `token`) ou
  para admin.
- `users`/`user`/`userByUsername` com o token de integração (`findPublicUser*`).
- Certificado público mascarado com `maskPublicCertificate` (admin vê tudo).
- `utils/personal-filters.js` tira chaves pessoais dos filtros de `communities` e `comments`;
  `comments` só popula `talk`, `event`, `user_creator`, `users_tagged`.

## Como conferir

Sem login, `curl -s https://bff.hubcommunity.io/graphql -H 'content-type: application/json' -d '{"query":"{ communityBySlugOrId(slugOrId:\"techstars\"){ organizers { email phone cpf date_of_birth } } }"}'`
devolve os quatro campos `null`. Testes: `src/__tests__/personal-data.test.js` (schema real, anônimo,
outra pessoa, a própria, admin, login) e `src/__tests__/personal-data-lookups.test.js`.
