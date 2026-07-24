from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import os
from pathlib import Path
import secrets
import sqlite3
import time
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from backend.ai import AIConfigurationError, AIService, AIServiceError
from backend.chat import (
    MAX_CARD_DETAILS_LENGTH,
    MAX_CARD_TITLE_LENGTH,
    MAX_HISTORY_MESSAGES,
    MAX_MESSAGE_LENGTH,
    StructuredChatResponse,
    build_chat_instructions,
    build_chat_messages,
    safety_identifier,
)
from backend.database import (
    BoardNotFoundError,
    CardNotFoundError,
    ColumnNotFoundError,
    InvalidCardOperationError,
    InvalidMoveError,
    LabelNotFoundError,
    LastBoardError,
    UsernameTakenError,
    apply_card_operations,
    create_board,
    create_card,
    create_label,
    delete_board,
    delete_card,
    delete_label,
    edit_card,
    get_board,
    initialize_database,
    list_boards,
    move_card,
    register_user,
    rename_board,
    rename_column,
    rename_label,
    set_card_labels,
    verify_login,
)


STATIC_DIR = Path(__file__).resolve().parents[1] / "frontend" / "out"
SESSION_COOKIE = "pm_session"
SESSION_MAX_AGE = 8 * 60 * 60
DEFAULT_DATABASE_PATH = Path("data") / "pm.db"
MAX_BOARD_NAME_LENGTH = 100
MAX_LABEL_NAME_LENGTH = 40
MAX_LABEL_COLOR_LENGTH = 20
MAX_USERNAME_LENGTH = 60
MAX_PASSWORD_LENGTH = 200

active_sessions: dict[str, tuple[str, float]] = {}

NonBlankText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]
NonNegativePosition = Annotated[int, Field(strict=True, ge=0)]
ChatText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_MESSAGE_LENGTH,
    ),
]
TitleText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_CARD_TITLE_LENGTH,
    ),
]
DetailsText = Annotated[
    str,
    StringConstraints(max_length=MAX_CARD_DETAILS_LENGTH),
]
BoardNameText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_BOARD_NAME_LENGTH,
    ),
]
LabelNameText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_LABEL_NAME_LENGTH,
    ),
]
LabelColorText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_LABEL_COLOR_LENGTH,
    ),
]
UsernameText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_USERNAME_LENGTH,
    ),
]
PasswordText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=MAX_PASSWORD_LENGTH),
]


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class LoginRequest(ApiModel):
    username: str
    password: str


class RegisterRequest(ApiModel):
    username: UsernameText
    password: PasswordText


class SessionResponse(ApiModel):
    authenticated: bool
    username: str | None = None


class LabelResponse(ApiModel):
    id: str
    name: str
    color: str


class CardResponse(ApiModel):
    id: str
    title: str
    details: str
    label_ids: list[str] = Field(alias="labelIds")


class ColumnResponse(ApiModel):
    id: str
    title: str
    card_ids: list[str] = Field(alias="cardIds")


class BoardResponse(ApiModel):
    columns: list[ColumnResponse]
    cards: dict[str, CardResponse]
    labels: list[LabelResponse]


class BoardSummaryResponse(ApiModel):
    id: int
    name: str


class CreateBoardRequest(ApiModel):
    name: BoardNameText


class RenameBoardRequest(ApiModel):
    name: BoardNameText


class RenameColumnRequest(ApiModel):
    title: TitleText


class CreateCardRequest(ApiModel):
    column_id: NonBlankText = Field(alias="columnId")
    title: TitleText
    details: DetailsText = ""


class EditCardRequest(ApiModel):
    title: TitleText
    details: DetailsText


class MoveCardRequest(ApiModel):
    column_id: NonBlankText = Field(alias="columnId")
    position: NonNegativePosition


class CreateLabelRequest(ApiModel):
    name: LabelNameText
    color: LabelColorText


class RenameLabelRequest(ApiModel):
    name: LabelNameText
    color: LabelColorText


class SetCardLabelsRequest(ApiModel):
    label_ids: list[NonBlankText] = Field(alias="labelIds")


class ChatHistoryMessage(ApiModel):
    role: Literal["user", "assistant"]
    content: ChatText


class ChatRequest(ApiModel):
    message: ChatText
    history: list[ChatHistoryMessage] = Field(
        default_factory=list,
        max_length=MAX_HISTORY_MESSAGES,
    )


class ChatResponse(ApiModel):
    reply: str
    board_changed: bool = Field(alias="boardChanged")
    board: BoardResponse | None = None


def _database_path() -> Path:
    return Path(os.environ.get("DATABASE_PATH", DEFAULT_DATABASE_PATH))


def _resolve_session(token: str | None) -> str | None:
    if token is None:
        return None
    session = active_sessions.get(token)
    if session is None:
        return None
    username, expires_at = session
    if time.time() >= expires_at:
        active_sessions.pop(token, None)
        return None
    return username


def _authenticated_username(request: Request) -> str:
    username = _resolve_session(request.cookies.get(SESSION_COOKIE))
    if username is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return username


def _start_session(username: str, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    active_sessions[token] = (username, time.time() + SESSION_MAX_AGE)
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )


def create_app(
    database_path: str | Path | None = None,
    ai_service: AIService | None = None,
) -> FastAPI:
    configured_database_path = Path(database_path or _database_path())

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        initialize_database(configured_database_path)
        yield

    api = FastAPI(title="Project Management MVP API")

    @api.exception_handler(BoardNotFoundError)
    def board_not_found(_: Request, __: BoardNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": "Board not found"})

    @api.exception_handler(ColumnNotFoundError)
    def column_not_found(_: Request, __: ColumnNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": "Column not found"})

    @api.exception_handler(CardNotFoundError)
    def card_not_found(_: Request, __: CardNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": "Card not found"})

    @api.exception_handler(LabelNotFoundError)
    def label_not_found(_: Request, __: LabelNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": "Label not found"})

    @api.exception_handler(InvalidMoveError)
    def invalid_move(_: Request, __: InvalidMoveError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"detail": "Invalid destination position"},
        )

    @api.exception_handler(LastBoardError)
    def last_board(_: Request, __: LastBoardError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"detail": "Cannot delete your only board"},
        )

    @api.exception_handler(UsernameTakenError)
    def username_taken(_: Request, __: UsernameTakenError) -> JSONResponse:
        return JSONResponse(
            status_code=409,
            content={"detail": "Username is already taken"},
        )

    @api.exception_handler(sqlite3.OperationalError)
    def database_busy(_: Request, __: sqlite3.OperationalError) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={"detail": "The board is busy. Please try again."},
        )

    @api.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @api.post("/auth/register", response_model=SessionResponse)
    def register(
        credentials: RegisterRequest,
        response: Response,
    ) -> SessionResponse:
        register_user(
            configured_database_path,
            credentials.username,
            credentials.password,
        )
        _start_session(credentials.username.strip(), response)
        return SessionResponse(authenticated=True, username=credentials.username.strip())

    @api.post("/auth/login", response_model=SessionResponse)
    def login(
        credentials: LoginRequest,
        response: Response,
    ) -> SessionResponse:
        if not verify_login(
            configured_database_path,
            credentials.username,
            credentials.password,
        ):
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid username or password"},
            )

        _start_session(credentials.username, response)
        return SessionResponse(authenticated=True, username=credentials.username)

    @api.get("/auth/session", response_model=SessionResponse)
    def current_session(request: Request) -> SessionResponse:
        token = request.cookies.get(SESSION_COOKIE)
        if token is None:
            return SessionResponse(authenticated=False)
        username = _resolve_session(token)
        if username is None:
            return JSONResponse(
                status_code=401,
                content={"detail": "Session is not valid"},
            )
        return SessionResponse(authenticated=True, username=username)

    @api.post("/auth/logout", response_model=SessionResponse)
    def logout(request: Request, response: Response) -> SessionResponse:
        token = request.cookies.get(SESSION_COOKIE)
        if token is not None:
            active_sessions.pop(token, None)
        response.delete_cookie(
            key=SESSION_COOKIE,
            httponly=True,
            samesite="lax",
            path="/",
        )
        return SessionResponse(authenticated=False)

    @api.get("/boards", response_model=list[BoardSummaryResponse])
    def read_boards(request: Request) -> list[dict[str, object]]:
        return list_boards(
            configured_database_path,
            _authenticated_username(request),
        )

    @api.post("/boards", response_model=BoardSummaryResponse, status_code=201)
    def add_board(
        payload: CreateBoardRequest,
        request: Request,
    ) -> dict[str, object]:
        return create_board(
            configured_database_path,
            _authenticated_username(request),
            payload.name,
        )

    @api.patch("/boards/{board_id}", response_model=BoardSummaryResponse)
    def update_board(
        board_id: int,
        payload: RenameBoardRequest,
        request: Request,
    ) -> dict[str, object]:
        return rename_board(
            configured_database_path,
            _authenticated_username(request),
            board_id,
            payload.name,
        )

    @api.delete("/boards/{board_id}", response_model=list[BoardSummaryResponse])
    def remove_board(board_id: int, request: Request) -> list[dict[str, object]]:
        return delete_board(
            configured_database_path,
            _authenticated_username(request),
            board_id,
        )

    @api.get("/boards/{board_id}", response_model=BoardResponse)
    def read_board(board_id: int, request: Request) -> dict[str, object]:
        return get_board(
            configured_database_path,
            _authenticated_username(request),
            board_id,
        )

    @api.patch(
        "/boards/{board_id}/columns/{column_id}",
        response_model=BoardResponse,
    )
    def update_column(
        board_id: int,
        column_id: str,
        payload: RenameColumnRequest,
        request: Request,
    ) -> dict[str, object]:
        return rename_column(
            configured_database_path,
            _authenticated_username(request),
            board_id,
            column_id,
            payload.title,
        )

    @api.post(
        "/boards/{board_id}/cards", response_model=BoardResponse, status_code=201
    )
    def add_card(
        board_id: int,
        payload: CreateCardRequest,
        request: Request,
    ) -> dict[str, object]:
        return create_card(
            configured_database_path,
            _authenticated_username(request),
            board_id,
            payload.column_id,
            payload.title,
            payload.details,
        )

    @api.patch("/boards/{board_id}/cards/{card_id}", response_model=BoardResponse)
    def update_card(
        board_id: int,
        card_id: str,
        payload: EditCardRequest,
        request: Request,
    ) -> dict[str, object]:
        return edit_card(
            configured_database_path,
            _authenticated_username(request),
            board_id,
            card_id,
            payload.title,
            payload.details,
        )

    @api.delete("/boards/{board_id}/cards/{card_id}", response_model=BoardResponse)
    def remove_card(
        board_id: int,
        card_id: str,
        request: Request,
    ) -> dict[str, object]:
        return delete_card(
            configured_database_path,
            _authenticated_username(request),
            board_id,
            card_id,
        )

    @api.post(
        "/boards/{board_id}/cards/{card_id}/move",
        response_model=BoardResponse,
    )
    def relocate_card(
        board_id: int,
        card_id: str,
        payload: MoveCardRequest,
        request: Request,
    ) -> dict[str, object]:
        return move_card(
            configured_database_path,
            _authenticated_username(request),
            board_id,
            card_id,
            payload.column_id,
            payload.position,
        )

    @api.put(
        "/boards/{board_id}/cards/{card_id}/labels",
        response_model=BoardResponse,
    )
    def update_card_labels(
        board_id: int,
        card_id: str,
        payload: SetCardLabelsRequest,
        request: Request,
    ) -> dict[str, object]:
        return set_card_labels(
            configured_database_path,
            _authenticated_username(request),
            board_id,
            card_id,
            payload.label_ids,
        )

    @api.post(
        "/boards/{board_id}/labels", response_model=BoardResponse, status_code=201
    )
    def add_label(
        board_id: int,
        payload: CreateLabelRequest,
        request: Request,
    ) -> dict[str, object]:
        return create_label(
            configured_database_path,
            _authenticated_username(request),
            board_id,
            payload.name,
            payload.color,
        )

    @api.patch(
        "/boards/{board_id}/labels/{label_id}",
        response_model=BoardResponse,
    )
    def update_label(
        board_id: int,
        label_id: str,
        payload: RenameLabelRequest,
        request: Request,
    ) -> dict[str, object]:
        return rename_label(
            configured_database_path,
            _authenticated_username(request),
            board_id,
            label_id,
            payload.name,
            payload.color,
        )

    @api.delete(
        "/boards/{board_id}/labels/{label_id}",
        response_model=BoardResponse,
    )
    def remove_label(
        board_id: int,
        label_id: str,
        request: Request,
    ) -> dict[str, object]:
        return delete_label(
            configured_database_path,
            _authenticated_username(request),
            board_id,
            label_id,
        )

    @api.post(
        "/boards/{board_id}/ai/chat",
        response_model=ChatResponse,
        response_model_exclude_none=True,
    )
    def chat(
        board_id: int,
        payload: ChatRequest,
        request: Request,
    ) -> ChatResponse:
        username = _authenticated_username(request)
        board = get_board(configured_database_path, username, board_id)

        try:
            service = ai_service or AIService.from_environment()
            result = service.generate_structured(
                instructions=build_chat_instructions(board),
                messages=build_chat_messages(
                    [message.model_dump() for message in payload.history],
                    payload.message,
                ),
                response_type=StructuredChatResponse,
                safety_identifier=safety_identifier(username),
            )
        except AIConfigurationError as error:
            raise HTTPException(
                status_code=503,
                detail="AI is not configured",
            ) from error
        except AIServiceError as error:
            raise HTTPException(
                status_code=502,
                detail="AI request failed",
            ) from error

        operations = [
            operation.model_dump(exclude_none=True)
            for operation in result.operations
        ]
        if not operations:
            return ChatResponse(reply=result.reply, board_changed=False)

        try:
            updated_board = apply_card_operations(
                configured_database_path,
                username,
                board_id,
                operations,
            )
        except (
            BoardNotFoundError,
            CardNotFoundError,
            ColumnNotFoundError,
            InvalidCardOperationError,
            InvalidMoveError,
        ) as error:
            raise HTTPException(
                status_code=502,
                detail="AI returned invalid board changes",
            ) from error

        return ChatResponse(
            reply=result.reply,
            board_changed=True,
            board=BoardResponse.model_validate(updated_board),
        )

    application = FastAPI(
        title="Project Management MVP",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @application.middleware("http")
    async def protect_authenticated_api(request: Request, call_next):
        path = request.url.path
        is_protected = path == "/api/boards" or path.startswith("/api/boards/")
        if is_protected:
            if _resolve_session(request.cookies.get(SESSION_COOKIE)) is None:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Authentication required"},
                )
        return await call_next(request)

    application.mount("/api", api)
    application.mount(
        "/",
        StaticFiles(directory=STATIC_DIR, html=True, check_dir=False),
        name="frontend",
    )
    return application


app = create_app()
