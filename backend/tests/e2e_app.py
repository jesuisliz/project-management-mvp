import json

from backend.chat import CardOperation, StructuredChatResponse
from backend.main import create_app


class DeterministicAIService:
    def generate_structured(self, **request: object) -> StructuredChatResponse:
        instructions = request["instructions"]
        messages = request["messages"]
        if not isinstance(instructions, str) or not isinstance(messages, list):
            raise TypeError("Unexpected chat request")

        board = json.loads(
            instructions.split("Authoritative board JSON:\n", maxsplit=1)[1]
        )
        message = messages[-1]["content"].lower()
        operations: list[CardOperation] = []
        reply = "The board is ready for your next step."

        if "create an ai launch card" in message:
            operations.append(
                CardOperation(
                    type="create_card",
                    card_id=None,
                    column_id="col-backlog",
                    title="AI launch card",
                    details="Created through chat.",
                    position=None,
                )
            )
            reply = "I created the AI launch card in Backlog."
        elif "edit the ai launch card" in message:
            card_id = next(
                card_id
                for card_id, card in board["cards"].items()
                if card["title"] == "AI launch card"
            )
            operations.append(
                CardOperation(
                    type="edit_card",
                    card_id=card_id,
                    column_id=None,
                    title="Edited AI launch card",
                    details="Edited through chat.",
                    position=None,
                )
            )
            reply = "I edited the AI launch card."
        elif "move the edited ai launch card" in message:
            card_id = next(
                card_id
                for card_id, card in board["cards"].items()
                if card["title"] == "Edited AI launch card"
            )
            operations.append(
                CardOperation(
                    type="move_card",
                    card_id=card_id,
                    column_id="col-review",
                    title=None,
                    details=None,
                    position=0,
                )
            )
            reply = "I moved the edited AI launch card to Review."
        elif "create two follow-up cards" in message:
            for title in ("AI follow-up one", "AI follow-up two"):
                operations.append(
                    CardOperation(
                        type="create_card",
                        card_id=None,
                        column_id="col-backlog",
                        title=title,
                        details="Created in one request.",
                        position=None,
                    )
                )
            reply = "I created both follow-up cards."
        elif "follow up on that" in message:
            reply = f"I received {len(messages) - 1} prior messages."

        return StructuredChatResponse(reply=reply, operations=operations)


app = create_app(ai_service=DeterministicAIService())
