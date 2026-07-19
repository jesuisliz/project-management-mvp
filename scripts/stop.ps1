$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

Push-Location $projectRoot
try {
    docker compose --project-name project-management-mvp down
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed to stop the application."
    }
}
finally {
    Pop-Location
}
