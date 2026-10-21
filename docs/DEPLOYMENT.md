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

**Netlify builds the test site from Git.** Site `days4fitness-portal`, branch
`main`, base directory `frontend`, build command `npm run build`, publish
directory `frontend/dist`.

Build-time values live in **Netlify → Site configuration → Environment
variables**, not in GitHub:

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | The Northflank service origin plus `/api` |
| `VITE_GOOGLE_CLIENT_ID` | The same client id the backend uses |

Neither is a secret and **neither may be marked "Contains secret values"**. Vite
writes `VITE_*` values into the bundle by design, and Netlify fails any deploy
where a value marked secret appears in the build output — so marking one rejects
exactly what is supposed to happen. A Google OAuth client ID is public anyway;
what protects it is the authorized origins list, not concealment.

`VITE_*` values are **build-time**. Changing one needs a redeploy; restarting
nothing achieves anything. Vite does not treat a missing value as an error, so
guard it in the build command rather than hoping:

```sh
[ -n "$VITE_API_URL" ] || { echo "VITE_API_URL is not set"; exit 1; }; npm run build
```

Without that, an empty `VITE_API_URL` falls back to `http://localhost:5000/api`,
the site deploys looking perfectly healthy, and every request fails in the
browser.

### The deferred GitHub Actions path

`.github/workflows/deploy-frontend.yml` builds `frontend/` and publishes with the
Netlify CLI. It is **`workflow_dispatch` only** — the push trigger is commented
out inside the file. It is intended for the real domain later.

When it takes over: restore the push trigger **and** stop Netlify's own builds
(Build & deploy → stop builds) in the same change. Two deployers publishing
`--prod` on one push will race, and the slower build wins. Its four values move
back to repository secrets: `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`,
`VITE_API_URL`, `VITE_GOOGLE_CLIENT_ID`.

### SPA fallback

`frontend/public/_redirects` holds `/*  /index.html  200`. Vite copies `public/`
into `dist/`, so it travels inside the published directory.

Netlify's framework detection currently applies this automatically for a Vite
build, so the file is redundant *for a Git-connected build* — verified on
2026-10-21, with `/clients`, `/settings` and `/reports` all returning the app
shell before the file was even committed. It is **not** redundant for the CLI
path: `netlify deploy --dir=dist` uploads a directory with no framework
detection at all, so without it every route except `/` would 404.

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
