from pathlib import Path
import secrets

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


STATIC_DIR = Path(__file__).resolve().parents[1] / "frontend" / "out"
SESSION_COOKIE = "pm_session"
SESSION_MAX_AGE = 8 * 60 * 60
MVP_USERNAME = "user"
MVP_PASSWORD = "password"

active_sessions: set[str] = set()


class LoginRequest(BaseModel):
    username: str
    password: str


class SessionResponse(BaseModel):
    authenticated: bool
    username: str | None = None

api = FastAPI(title="Project Management MVP API")


@api.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@api.post("/auth/login", response_model=SessionResponse)
def login(credentials: LoginRequest, response: Response) -> SessionResponse:
    if (
        credentials.username != MVP_USERNAME
        or credentials.password != MVP_PASSWORD
    ):
        return JSONResponse(
            status_code=401,
            content={"detail": "Invalid username or password"},
        )

    token = secrets.token_urlsafe(32)
    active_sessions.add(token)
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
    if token not in active_sessions:
        return JSONResponse(
            status_code=401,
            content={"detail": "Session is not valid"},
        )
    return SessionResponse(authenticated=True, username=MVP_USERNAME)


@api.post("/auth/logout", response_model=SessionResponse)
def logout(request: Request, response: Response) -> SessionResponse:
    token = request.cookies.get(SESSION_COOKIE)
    if token is not None:
        active_sessions.discard(token)
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return SessionResponse(authenticated=False)


app = FastAPI(
    title="Project Management MVP",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.middleware("http")
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


app.mount("/api", api)
app.mount(
    "/",
    StaticFiles(directory=STATIC_DIR, html=True, check_dir=False),
    name="frontend",
)
