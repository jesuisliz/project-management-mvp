#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

cd "$project_root"
docker compose --project-name project-management-mvp up --build --detach --wait --wait-timeout 60

echo "Project Management MVP is running at http://localhost:8000"
