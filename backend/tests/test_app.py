import re

from fastapi.testclient import TestClient

from backend.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root_serves_exported_kanban() -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert "Kanban Studio" in response.text


def test_root_references_a_served_static_asset() -> None:
    root_response = client.get("/")
    asset_paths = re.findall(r'(?:src|href)="([^"]+)"', root_response.text)
    asset_path = next(
        path for path in asset_paths if path.startswith("/_next/static/")
    )

    asset_response = client.get(asset_path)

    assert asset_response.status_code == 200
    assert asset_response.content
    assert "text/html" not in asset_response.headers["content-type"]


def test_unknown_api_path_returns_api_404() -> None:
    response = client.get("/api/not-a-route")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}
