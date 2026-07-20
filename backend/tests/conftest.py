from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import active_sessions, create_app


@pytest.fixture(autouse=True)
def clear_sessions() -> Iterator[None]:
    active_sessions.clear()
    yield
    active_sessions.clear()


@pytest.fixture
def database_path(tmp_path: Path) -> Path:
    return tmp_path / "pm.db"


@pytest.fixture
def client(database_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(database_path)) as test_client:
        yield test_client
