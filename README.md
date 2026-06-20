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
    init/                  # Local Docker database initialization
    migrations/            # SQL migrations and seed data
  docker-compose.yml       # Local PostgreSQL service
```

## 1) Start the Local Database

Install and start Docker Desktop, then verify Docker is available:

```powershell
docker --version
docker compose version
```

From the repository root, start PostgreSQL:

```powershell
docker compose up -d
```

Check that the container is healthy:

```powershell
docker compose ps
```

The Docker setup creates:

- Development database: `days4fitness`
- Test database: `days4fitness_test`
- PostgreSQL user: `postgres`
- PostgreSQL password: `postgres`
- Host port: `5433`

Port `5433` is used to avoid conflicts with PostgreSQL installations that commonly use port `5432`.

Copy the backend environment file:

```powershell
Copy-Item backend/.env.example backend/.env
```

Ensure `backend/.env` contains:

```env
NODE_ENV=development
PORT=5000
CORS_ORIGINS=http://localhost:5173
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/days4fitness
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/days4fitness_test
GOOGLE_CLIENT_ID=
```

`backend/.env` is ignored by Git and must not be committed.

## 2) Install Dependencies

From repo root:

```powershell
cd backend
npm install
cd ..\frontend
npm install
```

## 3) Run Database Migrations

With the Docker database running:

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

To verify the database directly:

```powershell
docker exec -it days4fitness-postgres psql -U postgres -d days4fitness
```

Inside `psql`:

```sql
\dt
SELECT * FROM programs;
\q
```

### Database Commands

Run these from the repository root:

```powershell
# Start PostgreSQL
docker compose up -d

# View container status
docker compose ps

# Follow PostgreSQL logs
docker compose logs -f postgres

# Stop PostgreSQL while preserving data
docker compose down

# Restart PostgreSQL
docker compose restart postgres
```

Avoid `docker compose down -v` unless you intentionally want to delete all local database data.

### pgAdmin Connection

Use these settings to connect pgAdmin to the Docker database:

```text
Host: localhost
Port: 5433
Maintenance database: days4fitness
Username: postgres
Password: postgres
```

## 4) Run the Backend

```powershell
cd backend
npm run dev
```

Test endpoints:
- `GET http://localhost:5000/`
- `GET http://localhost:5000/api/health`
- `GET http://localhost:5000/api/health/ready`
- `GET http://localhost:5000/api/configuration`
- `POST http://localhost:5000/api/auth/login`
- `POST http://localhost:5000/api/auth/google`
- `POST http://localhost:5000/api/auth/google/signup`

Private endpoints such as `GET /api/clients` require a bearer token.

## 5) Run the Frontend

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

## Documentation

- API reference: `docs/API.md`
- Backup and restore: `docs/BACKUP_AND_RESTORE.md`
- Deployment and migrations: `docs/DEPLOYMENT.md`
- Release test checklist: `docs/E2E_TESTS.md`

## Development vs Production DB Notes

- Development:
  - Use the Docker PostgreSQL service with `.env` secrets stored locally only.
  - Use `days4fitness_test` only for automated database integration tests.
  - Keep migrations in `database/migrations` and run them in CI and local.
- Production:
  - Use managed PostgreSQL (Neon, Supabase, Railway, Render, AWS RDS).
  - Use `DATABASE_URL` from hosting provider.
  - Run migrations during deployment step before API start.
  - Restrict DB network access and enforce SSL where required.
