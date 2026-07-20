FROM node:24.18.0-trixie-slim AS frontend-build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.11.29-python3.14-trixie-slim AS base

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev

COPY backend ./backend
COPY --from=frontend-build /app/frontend/out ./frontend/out

EXPOSE 8000

CMD ["uv", "run", "--no-sync", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS test

COPY docs ./docs
RUN uv sync --locked

CMD ["uv", "run", "--no-sync", "pytest"]

FROM base AS production

RUN groupadd --system app \
    && useradd --system --create-home --gid app app \
    && mkdir -p /app/data \
    && chown -R app:app /app \
    && apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uv", "run", "--no-sync", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
