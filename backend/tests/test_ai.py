from types import SimpleNamespace

import pytest
from openai import OpenAIError

from backend.ai import (
    DEFAULT_OPENAI_MODEL,
    AIConfigurationError,
    AIService,
    AIServiceError,
)


class FakeResponses:
    def __init__(
        self,
        output_text: str = "4",
        error: OpenAIError | None = None,
    ) -> None:
        self.output_text = output_text
        self.error = error
        self.request: dict[str, object] | None = None

    def create(self, **kwargs: object) -> SimpleNamespace:
        self.request = kwargs
        if self.error is not None:
            raise self.error
        return SimpleNamespace(output_text=self.output_text)


class FakeClient:
    def __init__(self, responses: FakeResponses) -> None:
        self.responses = responses


def test_generate_text_passes_model_prompt_and_reasoning() -> None:
    responses = FakeResponses(output_text=" 4 ")
    service = AIService(FakeClient(responses), "test-model")

    assert service.generate_text("What is 2+2?") == "4"
    assert responses.request == {
        "model": "test-model",
        "input": "What is 2+2?",
        "reasoning": {"effort": "low"},
    }


def test_environment_configuration_uses_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("OPENAI_MODEL", raising=False)

    service = AIService.from_environment()

    assert service.model == DEFAULT_OPENAI_MODEL


def test_environment_configuration_uses_model_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_MODEL", "custom-model")

    service = AIService.from_environment()

    assert service.model == "custom-model"


def test_missing_api_key_has_concise_configuration_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    with pytest.raises(AIConfigurationError, match="^OpenAI is not configured$"):
        AIService.from_environment()


def test_provider_error_does_not_leak_details() -> None:
    secret = "sk-unit-test-secret"
    responses = FakeResponses(error=OpenAIError(f"Rejected {secret}"))
    service = AIService(FakeClient(responses), "test-model")

    with pytest.raises(AIServiceError) as captured_error:
        service.generate_text("What is 2+2?")

    assert str(captured_error.value) == "OpenAI request failed"
    assert secret not in str(captured_error.value)


def test_empty_provider_output_is_rejected() -> None:
    service = AIService(FakeClient(FakeResponses(output_text="  ")), "test-model")

    with pytest.raises(AIServiceError, match="^OpenAI returned no text$"):
        service.generate_text("What is 2+2?")
