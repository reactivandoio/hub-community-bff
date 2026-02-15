# Eventando BFF Integration: LLM-First Guide

This guide describes how to interact with the Eventando Manager via the BFF GraphQL API.

## Core Entities

### Event
- `title` (String!)
- `description` (JSON)
- `start_date` (String!)
- `end_date` (String!)
- `max_slots` (Int)
- `products` (List of `Product`)

### Product
- `name` (String)
- `enabled` (Boolean)
- `batches` (List of `Batch`)

### Batch
- `batch_number` (Int)
- `value` (Float) - Price in major units (e.g., 100.00). *Note: The BFF handles conversion to cents for the Manager API if needed.*
- `max_quantity` (Int)
- `valid_from` (String)
- `valid_until` (String)

---

## Workflows

### 1. Creating an Event
Use the `createEvent` mutation. This targets the `EVENTANDO_MANAGER_URL`.

**Mutation:**
```graphql
mutation CreateEvent($data: EventInput!) {
  createEvent(data: $data) {
    id
    title
    slug
  }
}
```

**Variables Example:**
```json
{
  "data": {
    "title": "Community Workshop",
    "start_date": "2026-04-10T10:00:00Z",
    "end_date": "2026-04-10T18:00:00Z",
    "max_slots": 50,
    "slug": "community-workshop-2026"
  }
}
```

### 2. Signing Up for an Event
Use the `signupToEvent` mutation.

**Mutation:**
```graphql
mutation Signup($eventId: String!, $name: String!, $email: String!, $batch_id: String!, $coupon_code: String, $is_student: Boolean) {
  signupToEvent(
    eventId: $eventId
    name: $name
    email: $email
    batch_id: $batch_id
    coupon_code: $coupon_code
    is_student: $is_student
  ) {
    success
    message
    payment
  }
}
```

**Variables Example:**
```json
{
  "eventId": "event_uuid_123",
  "name": "Jane Doe",
  "email": "jane@example.com",
  "batch_id": "456",
  "coupon_code": "WELCOME2026",
  "is_student": true
}
```

---

## Rules & Validations
- Signups require a valid `batch_id`.
- The `is_student` flag may apply discounts if configured in the Manager.
- The BFF uses `eventandoIntegration` data source which uses a dedicated integration token.
