import re

from fastapi.testclient import TestClient

from backend.main import SESSION_COOKIE, app


def test_health() -> None:
    client = TestClient(app)
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root_serves_exported_kanban() -> None:
    client = TestClient(app)
    response = client.get("/")

    assert response.status_code == 200
    assert "Loading your workspace" in response.text


def test_root_references_a_served_static_asset() -> None:
    client = TestClient(app)
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
    client = TestClient(app)
    response = client.get("/api/not-a-route")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_login_sets_http_only_session_cookie() -> None:
    client = TestClient(app)

    response = client.post(
        "/api/auth/login",
        json={"username": "user", "password": "password"},
    )

    assert response.status_code == 200
    assert response.json() == {"authenticated": True, "username": "user"}
    assert SESSION_COOKIE in response.cookies
    set_cookie = response.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "path=/" in set_cookie


def test_invalid_login_is_rejected_without_a_cookie() -> None:
    client = TestClient(app)

    for credentials in (
        {"username": "user", "password": "wrong"},
        {"username": "wrong", "password": "password"},
    ):
        response = client.post("/api/auth/login", json=credentials)

        assert response.status_code == 401
        assert response.json() == {"detail": "Invalid username or password"}
        assert SESSION_COOKIE not in response.cookies


def test_session_reports_anonymous_and_authenticated_states() -> None:
    client = TestClient(app)

    anonymous_response = client.get("/api/auth/session")
    assert anonymous_response.status_code == 200
    assert anonymous_response.json() == {
        "authenticated": False,
        "username": None,
    }

    client.post(
        "/api/auth/login",
        json={"username": "user", "password": "password"},
    )
    authenticated_response = client.get("/api/auth/session")
    assert authenticated_response.status_code == 200
    assert authenticated_response.json() == {
        "authenticated": True,
        "username": "user",
    }


def test_invalid_session_cookie_is_rejected() -> None:
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, "not-a-valid-session")

    response = client.get("/api/auth/session")

    assert response.status_code == 401


def test_logout_invalidates_and_clears_the_session_cookie() -> None:
    client = TestClient(app)
    client.post(
        "/api/auth/login",
        json={"username": "user", "password": "password"},
    )

    logout_response = client.post("/api/auth/logout")
    session_response = client.get("/api/auth/session")

    assert logout_response.status_code == 200
    assert logout_response.json() == {"authenticated": False, "username": None}
    assert f"{SESSION_COOKIE}=\"\"" in logout_response.headers["set-cookie"]
    assert "Max-Age=0" in logout_response.headers["set-cookie"]
    assert session_response.json() == {"authenticated": False, "username": None}


def test_board_api_namespace_requires_authentication() -> None:
    anonymous_client = TestClient(app)
    anonymous_response = anonymous_client.get("/api/board")
    assert anonymous_response.status_code == 401
    assert anonymous_response.json() == {"detail": "Authentication required"}

    authenticated_client = TestClient(app)
    authenticated_client.post(
        "/api/auth/login",
        json={"username": "user", "password": "password"},
    )
    authenticated_response = authenticated_client.get("/api/board")
    assert authenticated_response.status_code == 404
