# Deployment And Migrations

## Required Environment Variables

Backend:

```env
NODE_ENV=production
PORT=5000
BUSINESS_TIMEZONE=Africa/Johannesburg
CORS_ORIGINS=https://your-trainer-portal-domain.com
DATABASE_URL=postgresql://...
DATABASE_SSL=true
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

`DATABASE_SSL` is `true` on a managed host, `no-verify` if that host signs with
its own certificate authority, and `false` locally. Leaving it unset hands the
decision to any `sslmode` already in `DATABASE_URL`.

`CORS_ORIGINS` must list the exact frontend origin, with no trailing slash and no
`localhost` entry — the server refuses to start in production if it finds one.

## Test Environment: Northflank And Netlify

The API and its database run on Northflank's free Sandbox; the frontend is built
in GitHub Actions and published to Netlify. The free Sandbox allows two
always-on services and one database, so the API and Postgres fill it exactly.

### Northflank: API And Postgres

1. Create the project, then add a **Postgres** addon.
2. Add a **combined build and deploy service** pointed at this repository with
   `backend/` as the build context.
3. Set the service environment from the block above. Take `DATABASE_URL` from the
   addon's connection details rather than typing it out, and set
   `DATABASE_SSL=true`. If the service then fails to connect with a certificate
   error, the addon is signing with its own authority — use `no-verify`.
4. Health checks: liveness on `/api/health`, readiness on `/api/health/ready`.
5. Run `npm run migrate` once the database is reachable. It uses the same pool as
   the server, so the `DATABASE_SSL` setting applies to it too.
6. Confirm `/api/health/ready` returns `"database": "connected"` over HTTPS.

### Node Version

`backend/package.json` pins `engines.node`. Keep the GitHub Actions workflow on
the same major version so a build cannot pass in CI and fail on the host.

### Redeploying And Logs

- A push to `main` triggers the Northflank build when the service is set to
  deploy on push; otherwise redeploy from the service's Deployments tab.
- Build and run logs are per-service under Logs; the readiness check failing is
  almost always `DATABASE_URL` or `DATABASE_SSL`.
- Re-running migrations is safe: every migration is guarded, and the runner
  records what it has already applied.

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
