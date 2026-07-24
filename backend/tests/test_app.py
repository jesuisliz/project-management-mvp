import json
from pathlib import Path
import re
import sqlite3
import time

from fastapi.testclient import TestClient
import pytest

from backend import main as main_module
from backend.database import get_board, list_boards, provision_user
from backend.main import SESSION_COOKIE, active_sessions


SAMPLE_BOARD_PATH = Path(__file__).parents[2] / "docs" / "sample-board.json"


def login(client: TestClient, username: str = "user", password: str = "password") -> None:
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200


def default_board_id(client: TestClient) -> int:
    boards = client.get("/api/boards").json()
    return boards[0]["id"]


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


def test_register_creates_a_working_account(
    client: TestClient,
    database_path: Path,
) -> None:
    response = client.post(
        "/api/auth/register",
        json={"username": "newuser", "password": "s3cret"},
    )

    assert response.status_code == 200
    assert response.json() == {"authenticated": True, "username": "newuser"}
    assert SESSION_COOKIE in response.cookies

    boards = client.get("/api/boards").json()
    assert len(boards) == 1
    assert len(get_board(database_path, "newuser", boards[0]["id"])["cards"]) == 0


def test_register_rejects_duplicate_username(client: TestClient) -> None:
    first = client.post(
        "/api/auth/register",
        json={"username": "dupe", "password": "password1"},
    )
    second = client.post(
        "/api/auth/register",
        json={"username": "dupe", "password": "password2"},
    )

    assert first.status_code == 200
    assert second.status_code == 409
    assert second.json() == {"detail": "Username is already taken"}


@pytest.mark.parametrize(
    "payload",
    [
        {"username": "   ", "password": "password"},
        {"username": "someone", "password": ""},
    ],
)
def test_register_rejects_blank_fields(
    client: TestClient,
    payload: dict[str, str],
) -> None:
    response = client.post("/api/auth/register", json=payload)

    assert response.status_code == 422


def test_registered_user_cannot_use_the_seed_password(client: TestClient) -> None:
    client.post(
        "/api/auth/register",
        json={"username": "another", "password": "their-own-password"},
    )

    response = client.post(
        "/api/auth/login",
        json={"username": "another", "password": "password"},
    )

    assert response.status_code == 401


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


def test_boards_api_namespace_requires_authentication(client: TestClient) -> None:
    anonymous_response = client.get("/api/boards")
    assert anonymous_response.status_code == 401
    assert anonymous_response.json() == {"detail": "Authentication required"}

    login(client)
    authenticated_response = client.get("/api/boards")
    assert authenticated_response.status_code == 200


def test_board_read_returns_the_demo_seed(client: TestClient) -> None:
    login(client)
    bid = default_board_id(client)

    response = client.get(f"/api/boards/{bid}")

    assert response.status_code == 200
    assert response.json() == json.loads(SAMPLE_BOARD_PATH.read_text())


def test_list_boards_returns_the_users_boards(client: TestClient) -> None:
    login(client)

    response = client.get("/api/boards")

    assert response.status_code == 200
    boards = response.json()
    assert len(boards) == 1
    assert boards[0]["name"] == "My Board"


def test_create_rename_and_delete_board(client: TestClient) -> None:
    login(client)

    create_response = client.post("/api/boards", json={"name": "Second board"})
    assert create_response.status_code == 201
    new_board_id = create_response.json()["id"]

    boards = client.get("/api/boards").json()
    assert len(boards) == 2

    new_board = client.get(f"/api/boards/{new_board_id}").json()
    assert new_board["columns"][0]["id"] == "col-backlog"
    assert new_board["cards"] == {}

    rename_response = client.patch(
        f"/api/boards/{new_board_id}",
        json={"name": "Renamed board"},
    )
    assert rename_response.status_code == 200
    assert rename_response.json() == {"id": new_board_id, "name": "Renamed board"}

    delete_response = client.delete(f"/api/boards/{new_board_id}")
    assert delete_response.status_code == 200
    assert len(delete_response.json()) == 1


def test_cannot_delete_the_last_remaining_board(client: TestClient) -> None:
    login(client)
    bid = default_board_id(client)

    response = client.delete(f"/api/boards/{bid}")

    assert response.status_code == 400
    assert response.json() == {"detail": "Cannot delete your only board"}


def test_board_routes_reject_another_users_board_id(
    client: TestClient,
    database_path: Path,
) -> None:
    provision_user(database_path, "other-user")
    other_board_id = list_boards(database_path, "other-user")[0]["id"]
    login(client)

    response = client.get(f"/api/boards/{other_board_id}")

    assert response.status_code == 404
    assert response.json() == {"detail": "Board not found"}


def test_rename_column(client: TestClient) -> None:
    login(client)
    bid = default_board_id(client)

    response = client.patch(
        f"/api/boards/{bid}/columns/col-backlog",
        json={"title": "Ready"},
    )

    assert response.status_code == 200
    assert response.json()["columns"][0]["title"] == "Ready"
    assert client.get(f"/api/boards/{bid}").json()["columns"][0]["title"] == "Ready"


def test_create_and_edit_card(client: TestClient) -> None:
    login(client)
    bid = default_board_id(client)
    original_ids = set(client.get(f"/api/boards/{bid}").json()["cards"])

    create_response = client.post(
        f"/api/boards/{bid}/cards",
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
        f"/api/boards/{bid}/cards/{new_id}",
        json={"title": "Edited card", "details": "Updated details."},
    )

    assert edit_response.status_code == 200
    assert edit_response.json()["cards"][new_id] == {
        "id": new_id,
        "title": "Edited card",
        "details": "Updated details.",
        "labelIds": [],
    }


def test_delete_card_compacts_order(client: TestClient) -> None:
    login(client)
    bid = default_board_id(client)

    response = client.delete(f"/api/boards/{bid}/cards/card-1")

    assert response.status_code == 200
    assert "card-1" not in response.json()["cards"]
    assert response.json()["columns"][0]["cardIds"] == ["card-2"]


def test_reorder_card_within_a_column(client: TestClient) -> None:
    login(client)
    bid = default_board_id(client)

    response = client.post(
        f"/api/boards/{bid}/cards/card-2/move",
        json={"columnId": "col-backlog", "position": 0},
    )

    assert response.status_code == 200
    assert response.json()["columns"][0]["cardIds"] == ["card-2", "card-1"]


def test_move_card_between_columns(client: TestClient) -> None:
    login(client)
    bid = default_board_id(client)

    response = client.post(
        f"/api/boards/{bid}/cards/card-1/move",
        json={"columnId": "col-review", "position": 1},
    )

    assert response.status_code == 200
    assert response.json()["columns"][0]["cardIds"] == ["card-2"]
    assert response.json()["columns"][3]["cardIds"] == ["card-6", "card-1"]


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    (
        ("patch", "/columns/col-backlog", {"title": "   "}),
        (
            "post",
            "/cards",
            {"columnId": "col-backlog", "title": " ", "details": ""},
        ),
        (
            "patch",
            "/cards/card-1",
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
    bid = default_board_id(client)

    response = client.request(method, f"/api/boards/{bid}{path}", json=payload)

    assert response.status_code == 422


@pytest.mark.parametrize(
    ("method", "path", "payload", "detail"),
    (
        (
            "patch",
            "/columns/not-a-column",
            {"title": "Missing"},
            "Column not found",
        ),
        (
            "post",
            "/cards",
            {"columnId": "not-a-column", "title": "Card", "details": ""},
            "Column not found",
        ),
        (
            "patch",
            "/cards/not-a-card",
            {"title": "Missing", "details": ""},
            "Card not found",
        ),
        (
            "delete",
            "/cards/not-a-card",
            None,
            "Card not found",
        ),
        (
            "post",
            "/cards/card-1/move",
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
    bid = default_board_id(client)

    response = client.request(method, f"/api/boards/{bid}{path}", json=payload)

    assert response.status_code == 404
    assert response.json() == {"detail": detail}


@pytest.mark.parametrize("position", (-1, "0"))
def test_invalid_position_shapes_are_rejected(
    client: TestClient,
    position: object,
) -> None:
    login(client)
    bid = default_board_id(client)

    response = client.post(
        f"/api/boards/{bid}/cards/card-1/move",
        json={"columnId": "col-review", "position": position},
    )

    assert response.status_code == 422


def test_out_of_range_move_leaves_board_unchanged(client: TestClient) -> None:
    login(client)
    bid = default_board_id(client)
    before = client.get(f"/api/boards/{bid}").json()

    response = client.post(
        f"/api/boards/{bid}/cards/card-1/move",
        json={"columnId": "col-review", "position": 99},
    )

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid destination position"}
    assert client.get(f"/api/boards/{bid}").json() == before


def test_fixed_columns_cannot_be_added_or_deleted(client: TestClient) -> None:
    login(client)
    bid = default_board_id(client)
    before = client.get(f"/api/boards/{bid}").json()

    add_response = client.post(
        f"/api/boards/{bid}/columns",
        json={"title": "Extra"},
    )
    delete_response = client.delete(f"/api/boards/{bid}/columns/col-backlog")

    assert add_response.status_code == 404
    assert delete_response.status_code == 405
    assert client.get(f"/api/boards/{bid}").json() == before


def test_session_is_scoped_to_its_users_board(
    client: TestClient,
    database_path: Path,
) -> None:
    provision_user(database_path, "other-user")
    other_board_id = list_boards(database_path, "other-user")[0]["id"]
    token = "other-user-session"
    active_sessions[token] = ("other-user", time.time() + 3600)
    client.cookies.set(SESSION_COOKIE, token)

    response = client.patch(
        f"/api/boards/{other_board_id}/columns/col-backlog",
        json={"title": "Other backlog"},
    )

    assert response.status_code == 200
    assert response.json()["columns"][0]["title"] == "Other backlog"
    login(client)
    bid = default_board_id(client)
    assert client.get(f"/api/boards/{bid}").json()["columns"][0]["title"] == "Backlog"


def test_expired_session_is_rejected_and_purged(client: TestClient) -> None:
    login(client)
    token = client.cookies.get(SESSION_COOKIE)
    username, _ = active_sessions[token]
    active_sessions[token] = (username, 0.0)

    response = client.get("/api/auth/session")

    assert response.status_code == 401
    assert token not in active_sessions


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    (
        (
            "patch",
            "/columns/col-backlog",
            {"title": "x" * 201},
        ),
        (
            "post",
            "/cards",
            {
                "columnId": "col-backlog",
                "title": "x" * 201,
                "details": "",
            },
        ),
        (
            "post",
            "/cards",
            {
                "columnId": "col-backlog",
                "title": "Card",
                "details": "x" * 4_001,
            },
        ),
        (
            "patch",
            "/cards/card-1",
            {"title": "x" * 201, "details": "Details"},
        ),
        (
            "patch",
            "/cards/card-1",
            {"title": "Card", "details": "x" * 4_001},
        ),
    ),
)
def test_oversized_title_or_details_is_rejected(
    client: TestClient,
    method: str,
    path: str,
    payload: dict[str, object],
) -> None:
    login(client)
    bid = default_board_id(client)

    response = client.request(method, f"/api/boards/{bid}{path}", json=payload)

    assert response.status_code == 422


def test_database_busy_returns_a_safe_error(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    login(client)
    bid = default_board_id(client)

    def locked(*_: object, **__: object) -> None:
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(main_module, "rename_column", locked)

    response = client.patch(
        f"/api/boards/{bid}/columns/col-backlog",
        json={"title": "Ready"},
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "The board is busy. Please try again."}


def test_create_rename_delete_label_and_assign_to_card(
    client: TestClient,
) -> None:
    login(client)
    bid = default_board_id(client)

    create_response = client.post(
        f"/api/boards/{bid}/labels",
        json={"name": "Urgent", "color": "#ecad0a"},
    )
    assert create_response.status_code == 201
    label = next(
        label
        for label in create_response.json()["labels"]
        if label["name"] == "Urgent"
    )

    assign_response = client.put(
        f"/api/boards/{bid}/cards/card-1/labels",
        json={"labelIds": [label["id"]]},
    )
    assert assign_response.status_code == 200
    assert assign_response.json()["cards"]["card-1"]["labelIds"] == [label["id"]]

    rename_response = client.patch(
        f"/api/boards/{bid}/labels/{label['id']}",
        json={"name": "Blocked", "color": "#753991"},
    )
    assert rename_response.status_code == 200
    renamed = next(
        entry
        for entry in rename_response.json()["labels"]
        if entry["id"] == label["id"]
    )
    assert renamed == {"id": label["id"], "name": "Blocked", "color": "#753991"}

    delete_response = client.delete(f"/api/boards/{bid}/labels/{label['id']}")
    assert delete_response.status_code == 200
    assert delete_response.json()["labels"] == []
    assert delete_response.json()["cards"]["card-1"]["labelIds"] == []


def test_assigning_an_unknown_label_is_rejected(client: TestClient) -> None:
    login(client)
    bid = default_board_id(client)

    response = client.put(
        f"/api/boards/{bid}/cards/card-1/labels",
        json={"labelIds": ["not-a-label"]},
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Label not found"}


def test_labels_are_scoped_to_their_board(client: TestClient) -> None:
    login(client)
    bid = default_board_id(client)
    other_board_id = client.post("/api/boards", json={"name": "Other"}).json()["id"]

    create_response = client.post(
        f"/api/boards/{bid}/labels",
        json={"name": "Only here", "color": "#209dd7"},
    )
    label_id = create_response.json()["labels"][0]["id"]

    response = client.patch(
        f"/api/boards/{other_board_id}/labels/{label_id}",
        json={"name": "Hijacked", "color": "#032147"},
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Label not found"}
