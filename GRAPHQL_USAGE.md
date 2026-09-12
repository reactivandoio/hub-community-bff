# GraphQL API - Guia de Uso

## Visão Geral
Este BFF (Backend For Frontend) oferece uma API GraphQL completa para consulta de dados do Strapi v5, incluindo funcionalidades avançadas de filtros, ordenação, busca e paginação.

## Entidades Disponíveis

### 1. Events (Eventos)
**Queries:**
- `events` - Lista paginada de eventos
- `event(id: String!)` - Evento específico
- `findEvents` - (Legacy) Lista de eventos

**Exemplo de uso:**
```graphql
query GetEvents {
  events(
    filters: {
      title: { contains: "tech" }
      start_date: { gte: "2024-01-01" }
    }
    sort: [{ field: "start_date", order: ASC }]
    pagination: { page: 1, pageSize: 10 }
    search: "conference"
  ) {
    data {
      id
      title
      description
      start_date
      end_date
      images
      community {
        id
        title
      }
      talks {
        id
        title
        speakers {
          id
          name
          avatar
        }
      }
    }
    meta {
      total
      page
      pageSize
      pageCount
    }
  }
}
```

### 2. Communities (Comunidades)
**Queries:**
- `communities` - Lista paginada de comunidades
- `community(id: String!)` - Comunidade específica

**Exemplo de uso:**
```graphql
query GetCommunities {
  communities(
    filters: {
      members_quantity: { gte: 100 }
      founded_in: { contains: "2020" }
    }
    sort: [{ field: "members_quantity", order: DESC }]
    pagination: { page: 1, pageSize: 5 }
  ) {
    data {
      id
      title
      short_description
      members_quantity
      organizers {
        id
        username
        email
      }
      events {
        id
        title
        start_date
      }
      tags {
        id
        value
      }
    }
    meta {
      total
      pageCount
    }
  }
}
```

### 3. Talks (Palestras)
**Queries:**
- `talks` - Lista paginada de palestras
- `talk(id: String!)` - Palestra específica

**Exemplo de uso:**
```graphql
query GetTalks {
  talks(
    filters: {
      highlight: { eq: true }
      occur_date: { gte: "2024-01-01" }
    }
    sort: [{ field: "occur_date", order: ASC }]
    search: "javascript"
  ) {
    data {
      id
      title
      description
      occur_date
      highlight
      speakers {
        id
        name
        biography
        avatar
      }
      event {
        id
        title
      }
    }
    meta {
      total
    }
  }
}
```

### 4. Speakers (Palestrantes)
**Queries:**
- `speakers` - Lista paginada de palestrantes
- `speaker(id: String!)` - Palestrante específico

**Exemplo de uso:**
```graphql
query GetSpeakers {
  speakers(
    filters: {
      highlight: { eq: true }
      name: { contains: "João" }
    }
    sort: [{ field: "name", order: ASC }]
  ) {
    data {
      id
      name
      biography
      avatar
      highlight
      talks {
        id
        title
        occur_date
      }
    }
  }
}
```

### 5. Locations (Locais)
**Queries:**
- `locations` - Lista paginada de locais
- `location(id: String!)` - Local específico

**Exemplo de uso:**
```graphql
query GetLocations {
  locations(
    filters: {
      city: { eq: "São Paulo" }
      region: { eq: "SP" }
    }
    sort: [{ field: "title", order: ASC }]
  ) {
    data {
      id
      title
      full_address
      city
      region
      latitude
      longitude
      google_maps_url
      events {
        id
        title
      }
    }
  }
}
```

### 6. Tags
**Queries:**
- `tags` - Lista paginada de tags
- `tag(id: String!)` - Tag específica

**Exemplo de uso:**
```graphql
query GetTags {
  tags(
    filters: {
      value: { contains: "tech" }
    }
    sort: [{ field: "value", order: ASC }]
  ) {
    data {
      id
      value
      events {
        id
        title
      }
      communities {
        id
        title
      }
    }
  }
}
```

### 7. Users (Usuários)
**Queries:**
- `users` - Lista paginada de usuários
- `user(id: String!)` - Usuário específico
- `userByUsername(username: String!)` - Usuário por username

**Exemplo de uso:**
```graphql
query GetUsers {
  users(
    filters: {
      role: { eq: "admin" }
      username: { contains: "admin" }
    }
    sort: [{ field: "username", order: ASC }]
  ) {
    data {
      id
      username
      email
      role
      communities {
        id
        title
      }
    }
  }
}

query GetUserByUsername($username: String!) {
  userByUsername(username: $username) {
    id
    username
    email
    role
    communities {
      id
      title
    }
  }
}
```

### 8. Comments (Comentários)
**Queries:**
- `comments` - Lista paginada de comentários
- `comment(id: String!)` - Comentário específico

**Exemplo de uso:**
```graphql
query GetComments {
  comments(
    filters: {
      comment: { contains: "excelente" }
    }
    sort: [{ field: "createdAt", order: DESC }]
  ) {
    data {
      id
      comment
      user {
        id
        username
      }
      event {
        id
        title
      }
      createdAt
    }
  }
}
```

## Tipos de Filtros Disponíveis

### StringFilter
- `eq` - igual a
- `ne` - diferente de
- `in` - está em (array)
- `notIn` - não está em (array)
- `contains` - contém
- `notContains` - não contém
- `startsWith` - começa com
- `endsWith` - termina com

### IntFilter
- `eq` - igual a
- `ne` - diferente de
- `gt` - maior que
- `gte` - maior ou igual a
- `lt` - menor que
- `lte` - menor ou igual a
- `in` - está em (array)
- `notIn` - não está em (array)

### BooleanFilter
- `eq` - igual a
- `ne` - diferente de

### DateFilter
- `eq` - igual a
- `ne` - diferente de
- `gt` - maior que
- `gte` - maior ou igual a
- `lt` - menor que
- `lte` - menor ou igual a

## Ordenação

Você pode ordenar por qualquer campo usando:
```graphql
sort: [
  { field: "title", order: ASC },
  { field: "createdAt", order: DESC }
]
```

## Paginação

```graphql
pagination: {
  page: 1,        # Página atual (padrão: 1)
  pageSize: 25    # Itens por página (padrão: 25)
}
```

## Busca

O parâmetro `search` faz busca nos campos `title`, `description` e `name` (quando disponíveis):
```graphql
search: "javascript conference"
```

## Filtros Relacionais

Você pode filtrar por campos de entidades relacionadas:
```graphql
filters: {
  community: {
    title: { contains: "tech" }
  }
  tags: {
    value: { in: ["javascript", "react"] }
  }
}
```

## Operadores Lógicos

Use `and` e `or` para combinar filtros:
```graphql
filters: {
  and: [
    { title: { contains: "tech" } },
    { start_date: { gte: "2024-01-01" } }
  ]
  or: [
    { highlight: { eq: true } },
    { members_quantity: { gte: 1000 } }
  ]
}
```

## Mutations e Subscriptions

### Mutations
- `submitEventComment(eventId: String!)` - Submete um comentário para um evento

### Subscriptions
- `commentEventAdded` - Escuta novos comentários adicionados

**Exemplo de Subscription:**
```graphql
subscription {
  commentEventAdded {
    id
    comment
    user {
      username
    }
    event {
      title
    }
  }
}
```

## Certificados

Certificado de participação em evento. `eventId` é sempre o `documentId` do evento no hub Strapi.

### Queries

- `certificateConfig(eventId: String!): CertificateConfig` — configuração do certificado do evento (modelo, logo, patrocinadores, assinaturas). **Não exige autenticação.**
- `certificateByCode(code: String!): Certificate` — busca um certificado pelo código público (usado na página de verificação). **Não exige autenticação.** Por privacidade, nesta query `identifier` e `email` voltam sempre `null` (as demais queries/mutations continuam devolvendo os dois campos).
- `lookupCertificate(eventId: String!, identifier: String!): LookupResult!` — verifica elegibilidade de um CPF para autoatendimento; emite automaticamente se o evento já terminou, a config permite e o CPF tem presença registrada. **Não exige autenticação.**
- `certificateCandidates(eventId: String!): [CertificateCandidate!]!` — lista consolidada (sem duplicar) de quem pode receber certificado: inscritos do Eventando (fonte `SIGNUP`), presenças confirmadas no hub (`ATTENDANCE`) e pedidos legados (`REQUEST`), unificados por CPF ou e-mail; quem já tem certificado emitido vem com `certificate.code` preenchido. Candidatos sem CPF têm o `identifier` preenchido a partir do formulário `sw-form` do hub (busca por e-mail, sem diferenciar maiúsculas), quando lá existe um CPF válido; um CPF já conhecido nunca é sobrescrito e uma falha nessa consulta não derruba a listagem. **Exige autenticação** (`authorization: Bearer <jwt>` de organizador).

```graphql
query { certificateConfig(eventId: "EV") { enabled title workload_hours issuer_name primary_color sponsors { name } signatures { name role text font } } }
```

```graphql
query { certificateByCode(code: "COD-XXXXXXXX") { code name event { title } } }
```

```graphql
query { lookupCertificate(eventId: "EV", identifier: "529.982.247-25") {
  certificate { code } eligible_by_attendance self_request_allowed event_ended revoked } }
```

```graphql
query { certificateCandidates(eventId: "EV") { key name email identifier sources checked_in certificate { code sent_at } } }
```

### Mutations

- `upsertCertificateConfig(eventId: String!, data: CertificateConfigInput!): CertificateConfig` — cria ou atualiza a configuração de certificado do evento. **Exige autenticação.**
  Cada assinatura pode ter `image` (id de mídia) ou `text` + `font` (assinatura em texto cursivo; `font` é `SignatureFont`: `great_vibes` (padrão), `allura` ou `dancing_script`). Quando `image` existe, ela prevalece sobre `text`.
- `copyCertificateConfig(fromEventId: String!, toEventId: String!): CertificateConfig` — copia a configuração de um evento para outro (sempre criada com `enabled: false`). **Exige autenticação.**
- `requestCertificate(eventId: String!, name: String!, identifier: String!, email: String!, phone: String): Certificate` — solicitação avulsa de certificado pelo próprio participante (autoatendimento). **Não exige autenticação.**
- `issueCertificates(eventId: String!, entries: [IssueEntryInput!]!, actions: IssueActionsInput!): IssueResult!` — emissão em lote pelo organizador, com `actions.register` (grava o certificado) e `actions.email` (envia o e-mail de aviso, exige `register: true`). `IssueEntryInput.identifier` (CPF) é opcional: com um CPF válido ele vira o identificador do certificado (só dígitos); sem CPF válido o identificador passa a ser o e-mail normalizado (sem espaços, minúsculo). Se nenhum dos dois servir o item falha com `"<nome>: CPF ou e-mail válido é obrigatório"`. Erros de itens individuais (identificador inválido, e-mail obrigatório, falha de SMTP) são coletados em `errors` e não interrompem o lote; reemitir para o mesmo identificador (CPF ou e-mail) no mesmo evento é idempotente (mesmo `code`). O autoatendimento (`lookupCertificate`/`requestCertificate`) continua exigindo CPF. **Exige autenticação.**

```graphql
mutation { upsertCertificateConfig(eventId: "EV", data: { enabled: true, title: "Certificado", sponsors: [], signatures: [{ name: "Ana", role: "Organizadora", text: "Ana Souza", font: allura }] }) { id enabled title signatures { name role image text font } } }
```

```graphql
mutation { copyCertificateConfig(fromEventId: "EV1", toEventId: "EV2") { id enabled title } }
```

```graphql
mutation { requestCertificate(eventId: "EV", name: "Maria", identifier: "529.982.247-25", email: "m@x.com") { code source } }
```

```graphql
mutation { issueCertificates(eventId: "EV",
  entries: [{ name: "Ana Souza", identifier: "529.982.247-25", email: "<seu e-mail>" }, { name: "Sem CPF", email: "semcpf@x.com" }, { name: "X", identifier: "123", email: "x@x.com" }],
  actions: { register: true, email: true }) { issued emailed errors certificates { code sent_at } } }
``` 