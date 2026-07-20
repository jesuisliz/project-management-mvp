import json
from pathlib import Path
import re

from fastapi.testclient import TestClient
import pytest

from backend.database import get_board, provision_user
from backend.main import SESSION_COOKIE, active_sessions


SAMPLE_BOARD_PATH = Path(__file__).parents[2] / "docs" / "sample-board.json"


def login(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login",
        json={"username": "user", "password": "password"},
    )
    assert response.status_code == 200


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root_serves_exported_kanban(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert "Loading your workspace" in response.text


def test_root_references_a_served_static_asset(client: TestClient) -> None:
    root_response = client.get("/")
    asset_paths = re.findall(r'(?:src|href)="([^"]+)"', root_response.text)
    asset_path = next(
        path for path in asset_paths if path.startswith("/_next/static/")
    )

    asset_response = client.get(asset_path)

    assert asset_response.status_code == 200
    assert asset_response.content
    assert "text/html" not in asset_response.headers["content-type"]


def test_unknown_api_path_returns_api_404(client: TestClient) -> None:
    response = client.get("/api/not-a-route")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_login_sets_http_only_session_cookie(client: TestClient) -> None:
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


def test_invalid_login_is_rejected_without_a_cookie(client: TestClient) -> None:
    for credentials in (
        {"username": "user", "password": "wrong"},
        {"username": "wrong", "password": "password"},
    ):
        response = client.post("/api/auth/login", json=credentials)

        assert response.status_code == 401
        assert response.json() == {"detail": "Invalid username or password"}
        assert SESSION_COOKIE not in response.cookies


def test_session_reports_anonymous_and_authenticated_states(
    client: TestClient,
) -> None:
    anonymous_response = client.get("/api/auth/session")
    assert anonymous_response.status_code == 200
    assert anonymous_response.json() == {
        "authenticated": False,
        "username": None,
    }

    login(client)
    authenticated_response = client.get("/api/auth/session")
    assert authenticated_response.status_code == 200
    assert authenticated_response.json() == {
        "authenticated": True,
        "username": "user",
    }


def test_invalid_session_cookie_is_rejected(client: TestClient) -> None:
    client.cookies.set(SESSION_COOKIE, "not-a-valid-session")

    response = client.get("/api/auth/session")

    assert response.status_code == 401


def test_logout_invalidates_and_clears_the_session_cookie(
    client: TestClient,
) -> None:
    login(client)

    logout_response = client.post("/api/auth/logout")
    session_response = client.get("/api/auth/session")

    assert logout_response.status_code == 200
    assert logout_response.json() == {"authenticated": False, "username": None}
    assert f'{SESSION_COOKIE}=""' in logout_response.headers["set-cookie"]
    assert "Max-Age=0" in logout_response.headers["set-cookie"]
    assert session_response.json() == {"authenticated": False, "username": None}


def test_board_api_namespace_requires_authentication(client: TestClient) -> None:
    anonymous_response = client.get("/api/board")
    assert anonymous_response.status_code == 401
    assert anonymous_response.json() == {"detail": "Authentication required"}

    login(client)
    authenticated_response = client.get("/api/board")
    assert authenticated_response.status_code == 200


def test_board_read_returns_the_demo_seed(client: TestClient) -> None:
    login(client)

    response = client.get("/api/board")

    assert response.status_code == 200
    assert response.json() == json.loads(SAMPLE_BOARD_PATH.read_text())


def test_rename_column(client: TestClient) -> None:
    login(client)

    response = client.patch(
        "/api/board/columns/col-backlog",
        json={"title": "Ready"},
    )

    assert response.status_code == 200
    assert response.json()["columns"][0]["title"] == "Ready"
    assert client.get("/api/board").json()["columns"][0]["title"] == "Ready"


def test_create_and_edit_card(client: TestClient) -> None:
    login(client)
    original_ids = set(client.get("/api/board").json()["cards"])

    create_response = client.post(
        "/api/board/cards",
        json={
            "columnId": "col-review",
            "title": "New card",
            "details": "Created through the API.",
        },
    )

    assert create_response.status_code == 201
    board = create_response.json()
    new_id = (set(board["cards"]) - original_ids).pop()
    assert board["columns"][3]["cardIds"][-1] == new_id

    edit_response = client.patch(
        f"/api/board/cards/{new_id}",
        json={"title": "Edited card", "details": "Updated details."},
    )

    assert edit_response.status_code == 200
    assert edit_response.json()["cards"][new_id] == {
        "id": new_id,
        "title": "Edited card",
        "details": "Updated details.",
    }


def test_delete_card_compacts_order(client: TestClient) -> None:
    login(client)

    response = client.delete("/api/board/cards/card-1")

    assert response.status_code == 200
    assert "card-1" not in response.json()["cards"]
    assert response.json()["columns"][0]["cardIds"] == ["card-2"]


def test_reorder_card_within_a_column(client: TestClient) -> None:
    login(client)

    response = client.post(
        "/api/board/cards/card-2/move",
        json={"columnId": "col-backlog", "position": 0},
    )

    assert response.status_code == 200
    assert response.json()["columns"][0]["cardIds"] == ["card-2", "card-1"]


def test_move_card_between_columns(client: TestClient) -> None:
    login(client)

    response = client.post(
        "/api/board/cards/card-1/move",
        json={"columnId": "col-review", "position": 1},
    )

    assert response.status_code == 200
    assert response.json()["columns"][0]["cardIds"] == ["card-2"]
    assert response.json()["columns"][3]["cardIds"] == ["card-6", "card-1"]


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    (
        ("patch", "/api/board/columns/col-backlog", {"title": "   "}),
        (
            "post",
            "/api/board/cards",
            {"columnId": "col-backlog", "title": " ", "details": ""},
        ),
        (
            "patch",
            "/api/board/cards/card-1",
            {"title": "", "details": "Details"},
        ),
    ),
)
def test_blank_required_fields_are_rejected(
    client: TestClient,
    method: str,
    path: str,
    payload: dict[str, object],
) -> None:
    login(client)

    response = client.request(method, path, json=payload)

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("method", "path", "payload", "detail"),
    (
        (
            "patch",
            "/api/board/columns/not-a-column",
            {"title": "Missing"},
            "Column not found",
        ),
        (
            "post",
            "/api/board/cards",
            {"columnId": "not-a-column", "title": "Card", "details": ""},
            "Column not found",
        ),
        (
            "patch",
            "/api/board/cards/not-a-card",
            {"title": "Missing", "details": ""},
            "Card not found",
        ),
        (
            "delete",
            "/api/board/cards/not-a-card",
            None,
            "Card not found",
        ),
        (
            "post",
            "/api/board/cards/card-1/move",
            {"columnId": "not-a-column", "position": 0},
            "Column not found",
        ),
    ),
)
def test_unknown_resources_are_rejected(
    client: TestClient,
    method: str,
    path: str,
    payload: dict[str, object] | None,
    detail: str,
) -> None:
    login(client)

    response = client.request(method, path, json=payload)

    assert response.status_code == 404
    assert response.json() == {"detail": detail}


@pytest.mark.parametrize("position", (-1, "0"))
def test_invalid_position_shapes_are_rejected(
    client: TestClient,
    position: object,
) -> None:
    login(client)

    response = client.post(
        "/api/board/cards/card-1/move",
        json={"columnId": "col-review", "position": position},
    )

    assert response.status_code == 422


def test_out_of_range_move_leaves_board_unchanged(client: TestClient) -> None:
    login(client)
    before = client.get("/api/board").json()

    response = client.post(
        "/api/board/cards/card-1/move",
        json={"columnId": "col-review", "position": 99},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid destination position"}
    assert client.get("/api/board").json() == before


def test_fixed_columns_cannot_be_added_or_deleted(client: TestClient) -> None:
    login(client)
    before = client.get("/api/board").json()

    add_response = client.post(
        "/api/board/columns",
        json={"title": "Extra"},
    )
    delete_response = client.delete("/api/board/columns/col-backlog")

    assert add_response.status_code == 404
    assert delete_response.status_code == 405
    assert client.get("/api/board").json() == before


def test_session_is_scoped_to_its_users_board(
    client: TestClient,
    database_path: Path,
) -> None:
    provision_user(database_path, "other-user")
    token = "other-user-session"
    active_sessions[token] = "other-user"
    client.cookies.set(SESSION_COOKIE, token)

    response = client.patch(
        "/api/board/columns/col-backlog",
        json={"title": "Other backlog"},
    )

    assert response.status_code == 200
    assert response.json()["columns"][0]["title"] == "Other backlog"
    assert get_board(database_path, "user")["columns"][0]["title"] == "Backlog"
