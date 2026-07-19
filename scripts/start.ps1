$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

Push-Location $projectRoot
try {
    docker compose --project-name project-management-mvp up --build --detach --wait --wait-timeout 60
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed to start the application."
    }
}
finally {
    Pop-Location
}

Write-Host "Project Management MVP is running at http://localhost:8000"
