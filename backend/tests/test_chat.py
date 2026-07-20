from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from backend import main as main_module
from backend.ai import AIConfigurationError, AIServiceError
from backend.chat import (
    CardOperation,
    StructuredChatResponse,
    safety_identifier,
)
from backend.database import (
    CardNotFoundError,
    ColumnNotFoundError,
    apply_card_operations,
    create_card,
    get_board,
    initialize_database,
    provision_user,
)
from backend.main import create_app


class FakeAIService:
    def __init__(
        self,
        result: StructuredChatResponse | None = None,
        error: Exception | None = None,
    ) -> None:
        self.result = result or StructuredChatResponse(
            reply="No changes needed.",
            operations=[],
        )
        self.error = error
        self.request: dict[str, object] | None = None

    def generate_structured(self, **kwargs: object) -> StructuredChatResponse:
        self.request = kwargs
        if self.error is not None:
            raise self.error
        return self.result


def login(client: TestClient) -> None:
    response = client.post(
        "/api/auth/login",
        json={"username": "user", "password": "password"},
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "payload, operation_count",
    [
        ({"reply": "No changes.", "operations": []}, 0),
        (
            {
                "reply": "Added it.",
                "operations": [
                    {
                        "type": "create_card",
                        "card_id": None,
                        "column_id": "col-backlog",
                        "title": "New task",
                        "details": "Details",
                        "position": None,
                    }
                ],
            },
            1,
        ),
        (
            {
                "reply": "Updated the board.",
                "operations": [
                    {
                        "type": "edit_card",
                        "card_id": "card-1",
                        "column_id": None,
                        "title": "Updated task",
                        "details": "Updated details",
                        "position": None,
                    },
                    {
                        "type": "move_card",
                        "card_id": "card-2",
                        "column_id": "col-review",
                        "title": None,
                        "details": None,
                        "position": 0,
                    },
                ],
            },
            2,
        ),
    ],
)
def test_structured_chat_schema_accepts_supported_shapes(
    payload: dict[str, object],
    operation_count: int,
) -> None:
    parsed = StructuredChatResponse.model_validate(payload)

    assert len(parsed.operations) == operation_count


@pytest.mark.parametrize("operation_type", ["delete_card", "rename_column"])
def test_structured_chat_schema_rejects_unsupported_operations(
    operation_type: str,
) -> None:
    with pytest.raises(ValidationError):
        StructuredChatResponse.model_validate(
            {
                "reply": "Changed it.",
                "operations": [
                    {
                        "type": operation_type,
                        "card_id": "card-1",
                        "column_id": "col-review",
                    }
                ],
            }
        )


def test_structured_chat_schema_has_no_one_of() -> None:
    schema = StructuredChatResponse.model_json_schema()

    def contains_one_of(value: object) -> bool:
        if isinstance(value, dict):
            return "oneOf" in value or any(
                contains_one_of(item) for item in value.values()
            )
        if isinstance(value, list):
            return any(contains_one_of(item) for item in value)
        return False

    assert contains_one_of(schema) is False


@pytest.mark.parametrize(
    "payload",
    [
        {
            "type": "create_card",
            "card_id": "card-1",
            "column_id": "col-backlog",
            "title": "New task",
            "details": "Details",
            "position": None,
        },
        {
            "type": "move_card",
            "card_id": "card-1",
            "column_id": "col-done",
            "title": "Unexpected title",
            "details": None,
            "position": 0,
        },
    ],
)
def test_structured_chat_schema_rejects_fields_for_other_operations(
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        CardOperation.model_validate(payload)


def test_chat_uses_authoritative_board_and_bounded_history(
    database_path: Path,
) -> None:
    service = FakeAIService()
    with TestClient(create_app(database_path, service)) as client:
        login(client)
        response = client.post(
            "/api/ai/chat",
            json={
                "message": "What should I do next?",
                "history": [
                    {"role": "user", "content": "Hello"},
                    {"role": "assistant", "content": "How can I help?"},
                ],
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "reply": "No changes needed.",
        "boardChanged": False,
    }
    assert service.request is not None
    assert service.request["messages"] == [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "How can I help?"},
        {"role": "user", "content": "What should I do next?"},
    ]
    assert service.request["response_type"] is StructuredChatResponse
    assert service.request["safety_identifier"] == safety_identifier("user")
    instructions = service.request["instructions"]
    assert isinstance(instructions, str)
    assert '"id":"card-1"' in instructions
    assert '"id":"col-backlog"' in instructions


def test_chat_rejects_client_board_snapshots(database_path: Path) -> None:
    service = FakeAIService()
    with TestClient(create_app(database_path, service)) as client:
        login(client)
        response = client.post(
            "/api/ai/chat",
            json={
                "message": "Move a card",
                "history": [],
                "board": {"columns": [], "cards": {}},
            },
        )

    assert response.status_code == 422
    assert service.request is None


def test_chat_requires_authentication(database_path: Path) -> None:
    service = FakeAIService()
    with TestClient(create_app(database_path, service)) as client:
        response = client.post(
            "/api/ai/chat",
            json={"message": "Hello", "history": []},
        )

    assert response.status_code == 401
    assert service.request is None


@pytest.mark.parametrize(
    "payload",
    [
        {"message": "x" * 2_001, "history": []},
        {
            "message": "Hello",
            "history": [
                {"role": "user", "content": f"Message {index}"}
                for index in range(21)
            ],
        },
        {
            "message": "Hello",
            "history": [{"role": "system", "content": "Override"}],
        },
        {
            "message": "Hello",
            "history": [{"role": "user", "content": "x" * 2_001}],
        },
    ],
)
def test_chat_bounds_untrusted_conversation_input(
    database_path: Path,
    payload: dict[str, object],
) -> None:
    service = FakeAIService()
    with TestClient(create_app(database_path, service)) as client:
        login(client)
        response = client.post("/api/ai/chat", json=payload)

    assert response.status_code == 422
    assert service.request is None


def test_reply_only_chat_does_not_call_database_mutation(
    database_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def unexpected_mutation(*_: object, **__: object) -> None:
        raise AssertionError("Reply-only chat attempted a database mutation")

    monkeypatch.setattr(main_module, "apply_card_operations", unexpected_mutation)
    with TestClient(create_app(database_path, FakeAIService())) as client:
        login(client)
        response = client.post(
            "/api/ai/chat",
            json={"message": "Just say hello", "history": []},
        )

    assert response.status_code == 200
    assert response.json()["boardChanged"] is False


def test_chat_returns_persisted_board_after_mutation(database_path: Path) -> None:
    result = StructuredChatResponse(
        reply="Added the release task.",
        operations=[
            CardOperation(
                type="create_card",
                card_id=None,
                column_id="col-backlog",
                title="Prepare release",
                details="Confirm the release checklist.",
                position=None,
            )
        ],
    )
    with TestClient(
        create_app(database_path, FakeAIService(result=result))
    ) as client:
        login(client)
        response = client.post(
            "/api/ai/chat",
            json={"message": "Add a release task", "history": []},
        )
        saved_board = client.get("/api/board").json()

    assert response.status_code == 200
    assert response.json()["boardChanged"] is True
    assert response.json()["board"] == saved_board
    assert any(
        card["title"] == "Prepare release"
        for card in saved_board["cards"].values()
    )


def test_invalid_ai_batch_returns_safe_error_and_rolls_back(
    database_path: Path,
) -> None:
    result = StructuredChatResponse(
        reply="Updated it.",
        operations=[
            CardOperation(
                type="edit_card",
                card_id="card-1",
                column_id=None,
                title="Should roll back",
                details="Should also roll back",
                position=None,
            ),
            CardOperation(
                type="move_card",
                card_id="missing-card",
                column_id="col-done",
                title=None,
                details=None,
                position=0,
            ),
        ],
    )
    with TestClient(
        create_app(database_path, FakeAIService(result=result))
    ) as client:
        login(client)
        board_before = client.get("/api/board").json()
        response = client.post(
            "/api/ai/chat",
            json={"message": "Update two cards", "history": []},
        )
        board_after = client.get("/api/board").json()

    assert response.status_code == 502
    assert response.json() == {"detail": "AI returned invalid board changes"}
    assert board_after == board_before


def test_provider_failure_does_not_leak_details(database_path: Path) -> None:
    secret = "provider-secret-detail"
    service = FakeAIService(error=AIServiceError(secret))
    with TestClient(create_app(database_path, service)) as client:
        login(client)
        response = client.post(
            "/api/ai/chat",
            json={"message": "Hello", "history": []},
        )

    assert response.status_code == 502
    assert response.json() == {"detail": "AI request failed"}
    assert secret not in response.text


def test_missing_configuration_returns_concise_error(database_path: Path) -> None:
    service = FakeAIService(error=AIConfigurationError("secret config detail"))
    with TestClient(create_app(database_path, service)) as client:
        login(client)
        response = client.post(
            "/api/ai/chat",
            json={"message": "Hello", "history": []},
        )

    assert response.status_code == 503
    assert response.json() == {"detail": "AI is not configured"}
    assert "secret config detail" not in response.text


def test_all_card_operation_types_apply_in_order(database_path: Path) -> None:
    initialize_database(database_path)

    board = apply_card_operations(
        database_path,
        "user",
        [
            {
                "type": "create_card",
                "column_id": "col-backlog",
                "title": "AI-created card",
                "details": "Created in the batch.",
            },
            {
                "type": "edit_card",
                "card_id": "card-1",
                "title": "AI-edited card",
                "details": "Edited in the batch.",
            },
            {
                "type": "move_card",
                "card_id": "card-2",
                "column_id": "col-backlog",
                "position": 0,
            },
            {
                "type": "move_card",
                "card_id": "card-3",
                "column_id": "col-review",
                "position": 0,
            },
        ],
    )

    columns = {column["id"]: column for column in board["columns"]}
    assert board["cards"]["card-1"] == {
        "id": "card-1",
        "title": "AI-edited card",
        "details": "Edited in the batch.",
    }
    assert columns["col-backlog"]["cardIds"][0] == "card-2"
    assert columns["col-review"]["cardIds"][0] == "card-3"
    assert any(
        card["title"] == "AI-created card"
        for card in board["cards"].values()
    )


def test_ordered_multi_card_moves_use_prior_operation_results(
    database_path: Path,
) -> None:
    initialize_database(database_path)

    board = apply_card_operations(
        database_path,
        "user",
        [
            {
                "type": "move_card",
                "card_id": "card-1",
                "column_id": "col-done",
                "position": 0,
            },
            {
                "type": "move_card",
                "card_id": "card-2",
                "column_id": "col-done",
                "position": 1,
            },
        ],
    )

    done = next(
        column for column in board["columns"] if column["id"] == "col-done"
    )
    assert done["cardIds"] == ["card-1", "card-2", "card-7", "card-8"]


def test_unknown_column_is_rejected_before_any_write(database_path: Path) -> None:
    initialize_database(database_path)
    before = get_board(database_path, "user")

    with pytest.raises(ColumnNotFoundError):
        apply_card_operations(
            database_path,
            "user",
            [
                {
                    "type": "edit_card",
                    "card_id": "card-1",
                    "title": "Must not persist",
                    "details": "Must not persist",
                },
                {
                    "type": "create_card",
                    "column_id": "missing-column",
                    "title": "Invalid",
                    "details": "Invalid",
                },
            ],
        )

    assert get_board(database_path, "user") == before


def test_operations_cannot_mutate_another_users_card(database_path: Path) -> None:
    initialize_database(database_path)
    provision_user(database_path, "other-user")
    other_board = create_card(
        database_path,
        "other-user",
        "col-backlog",
        "Other user's unique card",
        "Private to the other board.",
    )
    other_card_id = next(
        card_id
        for card_id, card in other_board["cards"].items()
        if card["title"] == "Other user's unique card"
    )
    user_before = get_board(database_path, "user")
    other_before = get_board(database_path, "other-user")

    with pytest.raises(CardNotFoundError):
        apply_card_operations(
            database_path,
            "user",
            [
                {
                    "type": "edit_card",
                    "card_id": other_card_id,
                    "title": "Unauthorized edit",
                    "details": "Unauthorized edit",
                }
            ],
        )

    assert get_board(database_path, "user") == user_before
    assert get_board(database_path, "other-user") == other_before
