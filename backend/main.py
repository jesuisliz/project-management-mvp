from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles


STATIC_DIR = Path(__file__).resolve().parents[1] / "frontend" / "out"

api = FastAPI(title="Project Management MVP API")


@api.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app = FastAPI(
    title="Project Management MVP",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.mount("/api", api)
app.mount(
    "/",
    StaticFiles(directory=STATIC_DIR, html=True, check_dir=False),
    name="frontend",
)
