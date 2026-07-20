import os
from typing import Protocol, TypeVar

from openai import OpenAI, OpenAIError
from pydantic import BaseModel, ValidationError


DEFAULT_OPENAI_MODEL = "gpt-5.6-terra"


class AIConfigurationError(Exception):
    pass


class AIServiceError(Exception):
    pass


class ResponseResult(Protocol):
    output_text: str


class ResponsesClient(Protocol):
    def create(self, **kwargs: object) -> ResponseResult: ...

    def parse(self, **kwargs: object) -> object: ...


class OpenAIClient(Protocol):
    responses: ResponsesClient


StructuredResponse = TypeVar("StructuredResponse", bound=BaseModel)


class AIService:
    def __init__(self, client: OpenAIClient, model: str) -> None:
        self.client = client
        self.model = model

    @classmethod
    def from_environment(cls) -> "AIService":
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise AIConfigurationError("OpenAI is not configured")

        model = os.environ.get("OPENAI_MODEL", DEFAULT_OPENAI_MODEL).strip()
        return cls(OpenAI(api_key=api_key), model or DEFAULT_OPENAI_MODEL)

    def generate_text(self, prompt: str) -> str:
        try:
            response = self.client.responses.create(
                model=self.model,
                input=prompt,
                reasoning={"effort": "low"},
            )
        except OpenAIError as error:
            raise AIServiceError("OpenAI request failed") from error

        output_text = response.output_text.strip()
        if not output_text:
            raise AIServiceError("OpenAI returned no text")
        return output_text

    def generate_structured(
        self,
        *,
        instructions: str,
        messages: list[dict[str, str]],
        response_type: type[StructuredResponse],
        safety_identifier: str,
    ) -> StructuredResponse:
        try:
            response = self.client.responses.parse(
                model=self.model,
                instructions=instructions,
                input=messages,
                text_format=response_type,
                reasoning={"effort": "low"},
                safety_identifier=safety_identifier,
                store=False,
            )
            parsed = getattr(response, "output_parsed", None)
        except (OpenAIError, ValidationError, ValueError) as error:
            raise AIServiceError("OpenAI request failed") from error

        if not isinstance(parsed, response_type):
            raise AIServiceError("OpenAI returned invalid structured output")
        return parsed
