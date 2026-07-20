import hashlib
import json
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)


MAX_HISTORY_MESSAGES = 20
MAX_MESSAGE_LENGTH = 2_000
MAX_OPERATIONS = 20
MAX_CARD_TITLE_LENGTH = 200
MAX_CARD_DETAILS_LENGTH = 4_000

NonBlankText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]
CardTitleText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_CARD_TITLE_LENGTH,
    ),
]
CardDetailsText = Annotated[
    str,
    StringConstraints(max_length=MAX_CARD_DETAILS_LENGTH),
]


class ChatModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CardOperation(ChatModel):
    type: Literal["create_card", "edit_card", "move_card"]
    card_id: NonBlankText | None
    column_id: NonBlankText | None
    title: CardTitleText | None
    details: CardDetailsText | None
    position: Annotated[int, Field(strict=True, ge=0)] | None

    @model_validator(mode="after")
    def validate_fields_for_type(self) -> "CardOperation":
        required_fields = {
            "create_card": {"column_id", "title", "details"},
            "edit_card": {"card_id", "title", "details"},
            "move_card": {"card_id", "column_id", "position"},
        }[self.type]
        populated_fields = {
            field_name
            for field_name in (
                "card_id",
                "column_id",
                "title",
                "details",
                "position",
            )
            if getattr(self, field_name) is not None
        }
        if populated_fields != required_fields:
            raise ValueError(f"Invalid fields for {self.type}")
        return self


class StructuredChatResponse(ChatModel):
    reply: NonBlankText
    operations: list[CardOperation] = Field(max_length=MAX_OPERATIONS)


def build_chat_instructions(board: dict[str, object]) -> str:
    board_json = json.dumps(board, separators=(",", ":"), sort_keys=True)
    return f"""You are the project board assistant.

Use only the authoritative board JSON below. Column and card IDs are stable.
You may create cards, edit cards, and move or reorder cards. Never delete cards,
rename columns, add columns, or remove columns.

If the user asks to delete a card, return no operations and set the reply
exactly to: Delete can only be done manually.

Every operation must include all five data fields. Set fields not used by that
operation to null:
- create_card uses column_id, title, and details; card_id and position are null.
  The card is appended to that existing column.
- edit_card uses card_id, title, and details; column_id and position are null.
  Return the complete new title and details.
- move_card uses card_id, column_id, and position; title and details are null.
  Position is zero-based in the destination column after removing the card from
  its source column.

Return a concise user-facing reply. Use an empty operations list when no board
change is needed or the request cannot be fulfilled safely. Do not invent IDs.

Authoritative board JSON:
{board_json}"""


def build_chat_messages(
    history: list[dict[str, str]],
    message: str,
) -> list[dict[str, str]]:
    return [*history, {"role": "user", "content": message}]


def safety_identifier(username: str) -> str:
    digest = hashlib.sha256(username.encode("utf-8")).hexdigest()
    return f"pm-{digest[:32]}"
