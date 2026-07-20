from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import os
from pathlib import Path
import secrets
from typing import Annotated

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from backend.database import (
    MVP_USERNAME,
    BoardNotFoundError,
    CardNotFoundError,
    ColumnNotFoundError,
    InvalidMoveError,
    create_card,
    delete_card,
    edit_card,
    get_board,
    initialize_database,
    move_card,
    rename_column,
)


STATIC_DIR = Path(__file__).resolve().parents[1] / "frontend" / "out"
SESSION_COOKIE = "pm_session"
SESSION_MAX_AGE = 8 * 60 * 60
MVP_PASSWORD = "password"
DEFAULT_DATABASE_PATH = Path("data") / "pm.db"

active_sessions: dict[str, str] = {}

NonBlankText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]
NonNegativePosition = Annotated[int, Field(strict=True, ge=0)]


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class LoginRequest(ApiModel):
    username: str
    password: str


class SessionResponse(ApiModel):
    authenticated: bool
    username: str | None = None


class CardResponse(ApiModel):
    id: str
    title: str
    details: str


class ColumnResponse(ApiModel):
    id: str
    title: str
    card_ids: list[str] = Field(alias="cardIds")


class BoardResponse(ApiModel):
    columns: list[ColumnResponse]
    cards: dict[str, CardResponse]


class RenameColumnRequest(ApiModel):
    title: NonBlankText


class CreateCardRequest(ApiModel):
    column_id: NonBlankText = Field(alias="columnId")
    title: NonBlankText
    details: str = ""


class EditCardRequest(ApiModel):
    title: NonBlankText
    details: str


class MoveCardRequest(ApiModel):
    column_id: NonBlankText = Field(alias="columnId")
    position: NonNegativePosition


def _database_path() -> Path:
    return Path(os.environ.get("DATABASE_PATH", DEFAULT_DATABASE_PATH))


def _authenticated_username(request: Request) -> str:
    token = request.cookies.get(SESSION_COOKIE)
    username = active_sessions.get(token) if token is not None else None
    if username is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return username


def create_app(database_path: str | Path | None = None) -> FastAPI:
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

    @api.exception_handler(InvalidMoveError)
    def invalid_move(_: Request, __: InvalidMoveError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"detail": "Invalid destination position"},
        )

    @api.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @api.post("/auth/login", response_model=SessionResponse)
    def login(
        credentials: LoginRequest,
        response: Response,
    ) -> SessionResponse:
        if (
            credentials.username != MVP_USERNAME
            or credentials.password != MVP_PASSWORD
        ):
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid username or password"},
            )

        token = secrets.token_urlsafe(32)
        active_sessions[token] = MVP_USERNAME
        response.set_cookie(
            key=SESSION_COOKIE,
            value=token,
            max_age=SESSION_MAX_AGE,
            httponly=True,
            samesite="lax",
            secure=False,
            path="/",
        )
        return SessionResponse(authenticated=True, username=MVP_USERNAME)

    @api.get("/auth/session", response_model=SessionResponse)
    def current_session(request: Request) -> SessionResponse:
        token = request.cookies.get(SESSION_COOKIE)
        if token is None:
            return SessionResponse(authenticated=False)
        username = active_sessions.get(token)
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

    @api.get("/board", response_model=BoardResponse)
    def read_board(request: Request) -> dict[str, object]:
        return get_board(
            configured_database_path,
            _authenticated_username(request),
        )

    @api.patch(
        "/board/columns/{column_id}",
        response_model=BoardResponse,
    )
    def update_column(
        column_id: str,
        payload: RenameColumnRequest,
        request: Request,
    ) -> dict[str, object]:
        return rename_column(
            configured_database_path,
            _authenticated_username(request),
            column_id,
            payload.title,
        )

    @api.post("/board/cards", response_model=BoardResponse, status_code=201)
    def add_card(
        payload: CreateCardRequest,
        request: Request,
    ) -> dict[str, object]:
        return create_card(
            configured_database_path,
            _authenticated_username(request),
            payload.column_id,
            payload.title,
            payload.details,
        )

    @api.patch("/board/cards/{card_id}", response_model=BoardResponse)
    def update_card(
        card_id: str,
        payload: EditCardRequest,
        request: Request,
    ) -> dict[str, object]:
        return edit_card(
            configured_database_path,
            _authenticated_username(request),
            card_id,
            payload.title,
            payload.details,
        )

    @api.delete("/board/cards/{card_id}", response_model=BoardResponse)
    def remove_card(card_id: str, request: Request) -> dict[str, object]:
        return delete_card(
            configured_database_path,
            _authenticated_username(request),
            card_id,
        )

    @api.post("/board/cards/{card_id}/move", response_model=BoardResponse)
    def relocate_card(
        card_id: str,
        payload: MoveCardRequest,
        request: Request,
    ) -> dict[str, object]:
        return move_card(
            configured_database_path,
            _authenticated_username(request),
            card_id,
            payload.column_id,
            payload.position,
        )

    application = FastAPI(
        title="Project Management MVP",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @application.middleware("http")
    async def protect_board_api(request: Request, call_next):
        path = request.url.path
        if path == "/api/board" or path.startswith("/api/board/"):
            token = request.cookies.get(SESSION_COOKIE)
            if token not in active_sessions:
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
