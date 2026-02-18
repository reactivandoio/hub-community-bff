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
Use the `createEvent` mutation.

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
    "slug": "community-workshop-2026",
    "pixai_token_integration": "your_token",
    "pixai_token_integration_id": "your_id"
  }
}
```

### 2. Creating a Product
Products must be linked to an Event ID.

**Mutation:**
```graphql
mutation CreateProduct($data: ProductInput!) {
  createProduct(data: $data) {
    id
    name
  }
}
```

**Variables Example:**
```json
{
  "data": {
    "name": "VIP Ticket",
    "event": "event_id_here",
    "enabled": true
  }
}
```

### 3. Creating a Batch
Batches must be linked to a Product ID.

**Mutation:**
```graphql
mutation CreateBatch($data: BatchInput!) {
  createBatch(data: $data) {
    id
    batch_number
    value
  }
}
```

**Variables Example:**
```json
{
  "data": {
    "batch_number": 1,
    "value": 150.00,
    "max_quantity": 100,
    "product": "product_id_here",
    "valid_from": "2026-02-15T00:00:00Z",
    "valid_until": "2026-03-15T23:59:59Z",
    "enabled": true,
    "half_price_eligible": true
  }
}
```

### 4. Creating a Coupon
Coupons are linked to an Event.

**Mutation:**
```graphql
mutation CreateCoupon($data: CouponInput!) {
  createCoupon(data: $data) {
    id
    code
  }
}
```

**Variables Example:**
```json
{
  "data": {
    "code": "COMMUNITY50",
    "discount_percentage": 50,
    "max_uses": 20,
    "event": "event_id_here",
    "enabled": true
  }
}
```

### 5. Signing Up for an Event
Use the `signupToEvent` mutation.

**Mutation:**
```graphql
mutation Signup($eventId: String!, $name: String!, $email: String!, $batch_id: String!, $coupon_code: String, $is_student: Boolean, $phone_number: String, $t_shirt_size: String) {
  signupToEvent(
    eventId: $eventId
    name: $name
    email: $email
    batch_id: $batch_id
    coupon_code: $coupon_code
    is_student: $is_student
    phone_number: $phone_number
    t_shirt_size: $t_shirt_size
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
  "coupon_code": "COMMUNITY50",
  "is_student": true,
  "phone_number": "11999999999",
  "t_shirt_size": "M"
}
```

---

## Rules & Validations
- Signups require a valid `batch_id`.
- The `is_student` flag may apply discounts if configured in the Manager.
- The BFF uses `eventandoIntegration` data source which uses a dedicated integration token.
