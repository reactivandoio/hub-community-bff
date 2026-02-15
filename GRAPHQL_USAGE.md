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