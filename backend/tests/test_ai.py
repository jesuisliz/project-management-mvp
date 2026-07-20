from types import SimpleNamespace

import pytest
from openai import OpenAIError

from backend.ai import (
    DEFAULT_OPENAI_MODEL,
    AIConfigurationError,
    AIService,
    AIServiceError,
)
from backend.chat import StructuredChatResponse


class FakeResponses:
    def __init__(
        self,
        output_text: str = "4",
        error: OpenAIError | None = None,
        parsed_output: object | None = None,
        parse_error: OpenAIError | None = None,
    ) -> None:
        self.output_text = output_text
        self.error = error
        self.parsed_output = parsed_output
        self.parse_error = parse_error
        self.request: dict[str, object] | None = None
        self.parse_request: dict[str, object] | None = None

    def create(self, **kwargs: object) -> SimpleNamespace:
        self.request = kwargs
        if self.error is not None:
            raise self.error
        return SimpleNamespace(output_text=self.output_text)

    def parse(self, **kwargs: object) -> SimpleNamespace:
        self.parse_request = kwargs
        if self.parse_error is not None:
            raise self.parse_error
        return SimpleNamespace(output_parsed=self.parsed_output)


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


def test_generate_structured_uses_strict_runtime_configuration() -> None:
    parsed = StructuredChatResponse(reply="No changes needed.", operations=[])
    responses = FakeResponses(parsed_output=parsed)
    service = AIService(FakeClient(responses), "test-model")
    messages = [{"role": "user", "content": "What should I do next?"}]

    result = service.generate_structured(
        instructions="Use this board.",
        messages=messages,
        response_type=StructuredChatResponse,
        safety_identifier="safe-user",
    )

    assert result is parsed
    assert responses.parse_request == {
        "model": "test-model",
        "instructions": "Use this board.",
        "input": messages,
        "text_format": StructuredChatResponse,
        "reasoning": {"effort": "low"},
        "safety_identifier": "safe-user",
        "store": False,
    }


def test_generate_structured_rejects_missing_parsed_output() -> None:
    service = AIService(FakeClient(FakeResponses()), "test-model")

    with pytest.raises(
        AIServiceError,
        match="^OpenAI returned invalid structured output$",
    ):
        service.generate_structured(
            instructions="Use this board.",
            messages=[{"role": "user", "content": "Hello"}],
            response_type=StructuredChatResponse,
            safety_identifier="safe-user",
        )


def test_generate_structured_sanitizes_provider_errors() -> None:
    secret = "sk-structured-secret"
    responses = FakeResponses(
        parse_error=OpenAIError(f"Provider failure {secret}"),
    )
    service = AIService(FakeClient(responses), "test-model")

    with pytest.raises(AIServiceError) as captured_error:
        service.generate_structured(
            instructions="Use this board.",
            messages=[{"role": "user", "content": "Hello"}],
            response_type=StructuredChatResponse,
            safety_identifier="safe-user",
        )

    assert str(captured_error.value) == "OpenAI request failed"
    assert secret not in str(captured_error.value)
