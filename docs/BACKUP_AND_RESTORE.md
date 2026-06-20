# Database Backup And Restore

## Local Backup

Run from the repository root while Docker is running:

```powershell
docker exec days4fitness-postgres pg_dump -U postgres -d days4fitness --format=custom --file=/tmp/days4fitness.backup
docker cp days4fitness-postgres:/tmp/days4fitness.backup .\days4fitness.backup
```

## Local Restore

Restore into an empty database:

```powershell
docker cp .\days4fitness.backup days4fitness-postgres:/tmp/days4fitness.backup
docker exec days4fitness-postgres pg_restore -U postgres -d days4fitness --clean --if-exists /tmp/days4fitness.backup
```

## Production Guidance

- Use managed PostgreSQL backups where possible.
- Schedule automated daily backups before going live.
- Keep at least one weekly backup for rollback safety.
- Test restore steps before relying on backups.
- Never store production backup files in Git.
