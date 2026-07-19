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
