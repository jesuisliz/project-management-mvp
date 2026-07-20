# Project Management MVP

## Prerequisite

Install Docker Desktop or Docker Engine with Compose.

## Start and stop

Windows PowerShell:

```powershell
./scripts/start.ps1
./scripts/stop.ps1
```

macOS or Linux:

```sh
sh scripts/start.sh
sh scripts/stop.sh
```

Open `http://localhost:8000` after starting.

Sign in with:

- Username: `user`
- Password: `password`

This is local MVP authentication only. Sessions are kept in server memory and
are not intended for production use.

Board data is stored in SQLite on the Compose-managed `pm-data` volume and
persists when the application container is stopped or recreated.

Column renames and card creation, inline editing, deletion, reordering, and
cross-column movement are saved through the authenticated board API.

## Tests

Frontend:

```sh
cd frontend
npm ci
npm run lint
npm run test:unit
npm run build
npm run test:e2e
```

Production container and backend:

```sh
docker build --target test --tag project-management-mvp-test .
docker run --rm project-management-mvp-test
```
