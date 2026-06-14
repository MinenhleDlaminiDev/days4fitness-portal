# Backend Testing

## Unit Tests

Run:

```powershell
npm test
```

Unit tests use Node's built-in test runner and injected repositories. They do not connect to PostgreSQL and cannot modify local development data.

## Database Integration Tests

Integration tests use the separate database configured through `TEST_DATABASE_URL`. Do not point this variable at the development or production database.

Recommended local database:

```text
days4fitness_test
```

Run:

```powershell
npm run test:integration
```

This command:

1. Refuses to run unless the database name contains `test`.
2. Applies all migrations to the test database.
3. Runs repository tests against PostgreSQL.
4. Cleans records created by each test.

Run all unit and integration tests with:

```powershell
npm run test:all
```
