# Days4Fitness API

Base URL:

```text
http://localhost:5000/api
```

Private endpoints require:

```http
Authorization: Bearer <session-token>
```

## Public Endpoints

- `GET /health`
- `GET /health/ready`
- `GET /configuration`
- `POST /auth/login`
- `POST /auth/google`
- `POST /auth/google/signup`

## Auth

### `POST /auth/login`

Local email/password login for development fallback.

```json
{
  "email": "trainer@days4fitness.local",
  "password": "ChangeMe123!"
}
```

### `POST /auth/google`

Google sign-in. During pre-live testing, verified `@gmail.com` accounts are allowed.

```json
{
  "credential": "<google-id-token>"
}
```

### `POST /auth/google/signup`

Google sign-up. During pre-live testing, this creates a trainer profile for verified `@gmail.com` accounts.

```json
{
  "credential": "<google-id-token>"
}
```

### `GET /auth/me`

Returns the authenticated trainer.

### `POST /auth/logout`

Revokes the current session token.

## Trainer Portal Endpoints

- `GET /dashboard`
- `GET /dashboard/today-sessions`
- `GET /clients`
- `POST /clients`
- `GET /clients/:id`
- `PATCH /clients/:id`
- `POST /clients/:id/archive`
- `POST /clients/:id/restore`
- `PATCH /clients/:id/preferences`
- `GET /clients/:id/packages`
- `POST /clients/:id/packages`
- `GET /clients/:id/sessions`
- `GET /booking-requests/pending`
- `POST /booking-requests/:id/approve`
- `POST /booking-requests/:id/reject`
- `GET /sessions`
- `POST /sessions`
- `GET /sessions/:id`
- `POST /sessions/:id/cancel`
- `POST /sessions/:id/reschedule`
- `POST /sessions/:id/replacement`
- `POST /sessions/:id/complete`
- `POST /sessions/:id/no-show`
- `POST /packages/:id/payments`
- `POST /packages/payments/:id/reverse`

## Response Format

Success:

```json
{
  "data": {}
}
```

Error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Example error"
  }
}
```
