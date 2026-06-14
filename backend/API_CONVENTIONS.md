# API Conventions

## Success Responses

All successful responses use a `data` envelope:

```json
{
  "data": {}
}
```

Collection endpoints return an array in `data`. Pagination and other collection information will be placed in an optional `meta` object.

## Error Responses

All errors use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable explanation",
    "details": {}
  }
}
```

`details` is optional and contains safe, structured context such as invalid field names or allowed values.

## Current Foundation Endpoints

- `GET /api/health`: process liveness.
- `GET /api/health/ready`: database readiness.
- `GET /api/configuration`: programs, pricing, package sizes, business hours, and shared rules.
- `GET /api/clients`: clients with their latest package.
- `GET /api/clients/:id`: one client with their latest package.
- `POST /api/clients`: create a client and initial package.
- `PATCH /api/clients/:id/preferences`: update scheduling preferences.
