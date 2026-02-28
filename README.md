# Days4Fitness Portal
Personal trainer management system for client, schedule, and payment tracking.

## Project Structure

```text
days4fitness-portal/
  backend/                 # Express API + PostgreSQL connection
    src/
      app.js
      server.js
      config/env.js
      db/client.js
      db/migrate.js
      routes/
      middleware/
  frontend/                # React + Vite + Tailwind app
    src/
      App.jsx
      components/
      pages/
      lib/api.js
  database/
    migrations/            # SQL migrations and seed data
```

## 1) PostgreSQL Local Setup (Windows)

1. Install PostgreSQL from the official installer:
   - https://www.postgresql.org/download/windows/
2. During install, keep note of:
   - `postgres` superuser password
   - default port (usually `5432`)
3. Open `psql` (SQL shell) and run:

```sql
CREATE DATABASE days4fitness;
```

4. Copy backend env file:

```powershell
Copy-Item backend/.env.example backend/.env
```

5. Update credentials in `backend/.env` to match your local PostgreSQL setup.

## 2) Install Dependencies

From repo root:

```powershell
cd backend
npm install
cd ..\frontend
npm install
```

## 3) Run Database Migrations

```powershell
cd backend
npm run migrate
```

This creates:
- `clients`
- `programs`
- `packages`
- `sessions`
- `package_pricing`

It also seeds programs + pricing based on your provided rate card.

## 4) Run Backend

```powershell
cd backend
npm run dev
```

Test endpoints:
- `GET http://localhost:5000/`
- `GET http://localhost:5000/api/health`
- `GET http://localhost:5000/api/clients` (example database endpoint)

## 5) Run Frontend

In another terminal:

```powershell
cd frontend
Copy-Item .env.example .env
npm run dev
```

Open:
- `http://localhost:5173`

Configured routes:
- `/` Dashboard
- `/schedule`
- `/clients`
- `/clients/new`
- `/clients/:id`
- `/clients/:id/edit`

## Development vs Production DB Notes

- Development:
  - Use local PostgreSQL with `.env` secrets stored locally only.
  - Keep migrations in `database/migrations` and run them in CI and local.
- Production:
  - Use managed PostgreSQL (Neon, Supabase, Railway, Render, AWS RDS).
  - Use `DATABASE_URL` from hosting provider.
  - Run migrations during deployment step before API start.
  - Restrict DB network access and enforce SSL where required.
