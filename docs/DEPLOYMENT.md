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
2. Add a **combined build and deploy service** pointed at this repository, with
   build type **Dockerfile** and these two paths:

   | Field | Value |
   | --- | --- |
   | Build context | `/` |
   | Dockerfile location | `/backend/Dockerfile` |

   The context is the repository root, **not** `/backend`. The migration runner
   resolves migrations to `<repo>/database/migrations`, which sits outside
   `backend/`, so a context of `/backend` cannot copy them and `npm run migrate`
   would find nothing to apply.
3. Set the service environment from the block above. Take `DATABASE_URL` from the
   addon's connection details rather than typing it out, and set
   `DATABASE_SSL=true`. If the service then fails to connect with a certificate
   error, the addon is signing with its own authority — use `no-verify`.
4. Health checks: liveness on `/api/health`, readiness on `/api/health/ready`.
5. Run `npm run migrate` from the service's shell once the database is reachable.
   It uses the same pool as the server, so the `DATABASE_SSL` setting applies to it
   too, and the image already carries the migration files.
6. Confirm `/api/health/ready` returns `"database": "connected"` over HTTPS.

### Building The Image Locally

The same image Northflank builds can be built and run from the repository root:

```sh
docker build -f backend/Dockerfile -t days4fitness-api:test .
docker run --rm -p 5055:5000   -e DATABASE_URL="postgresql://postgres:postgres@host.docker.internal:5433/days4fitness"   -e DATABASE_SSL=false   -e CORS_ORIGINS="https://your-site.netlify.app"   days4fitness-api:test
```

`CORS_ORIGINS` must be a real non-localhost origin even for a local container run,
because the image sets `NODE_ENV=production` and the server refuses to start in
production when it finds a `localhost` origin.

### Netlify: Frontend

GitHub Actions builds the site and publishes it with the Netlify CLI. **Netlify
itself is not connected to the repository** — if it were, both would build on
every push and race to publish.

Workflow: `.github/workflows/deploy-frontend.yml`. It runs on a push to `main`
that touches `frontend/`, and on manual dispatch.

Repository secrets, under Settings → Secrets and variables → Actions:

| Secret | Where it comes from |
| --- | --- |
| `NETLIFY_AUTH_TOKEN` | Netlify → User settings → Applications → new access token |
| `NETLIFY_SITE_ID` | The site's API ID, under Site configuration → General |
| `VITE_API_URL` | The Northflank service origin plus `/api` |
| `VITE_GOOGLE_CLIENT_ID` | The same client id the backend uses |

`VITE_*` values are **build-time**. Vite writes them into the bundle, so changing
one means re-running the workflow — restarting anything achieves nothing. The
workflow fails early and deliberately if `VITE_API_URL` is empty, because Vite
treats a missing value as acceptable and the app would quietly fall back to
`http://localhost:5000/api`: the site would deploy and look fine while every
request failed in the browser.

The SPA fallback is `frontend/public/_redirects`, not a `netlify.toml`. Vite
copies `public/` into `dist/`, so the rule travels inside the published directory
whatever working directory the CLI runs from. Without it, a hard refresh on any
route other than `/` returns a Netlify 404, since no such file exists in the
build. The workflow checks for it and refuses to publish if it is missing.

**When the site URL changes, update `CORS_ORIGINS` on the Northflank service to
match exactly** — `https`, no trailing slash, no path. Getting this wrong is
easy to miss: health checks and `curl` keep working, because requests without an
`Origin` header are always allowed. Only the browser is refused.

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
