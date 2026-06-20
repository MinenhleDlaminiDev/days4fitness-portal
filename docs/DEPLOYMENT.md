# Deployment And Migrations

## Required Environment Variables

Backend:

```env
NODE_ENV=production
PORT=5000
BUSINESS_TIMEZONE=Africa/Johannesburg
CORS_ORIGINS=https://your-trainer-portal-domain.com
DATABASE_URL=postgresql://...
GOOGLE_CLIENT_ID=...
AUTH_SESSION_HOURS=12
REQUEST_BODY_LIMIT=100kb
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=300
AUTH_RATE_LIMIT_MAX=30
TRUST_PROXY=true
```

Frontend:

```env
VITE_API_URL=https://your-api-domain.com/api
VITE_GOOGLE_CLIENT_ID=...
```

## Migration Strategy

1. Take or confirm a fresh database backup.
2. Deploy backend code.
3. Run `npm run migrate` against the production database.
4. Start or restart the backend service.
5. Deploy frontend code.
6. Verify `/api/health/ready`.
7. Run a login smoke test.

## Rollback Notes

- Migrations are forward-only right now.
- If a deployment fails after migrations run, prefer fixing forward.
- If data is damaged, restore from the latest verified backup.
- Do not run destructive SQL manually without a fresh backup.
