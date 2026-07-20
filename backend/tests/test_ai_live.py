import os

import pytest

from backend.ai import AIService


pytestmark = pytest.mark.live


def test_live_openai_connectivity() -> None:
    if os.environ.get("RUN_OPENAI_LIVE_TEST") != "1":
        pytest.skip("Set RUN_OPENAI_LIVE_TEST=1 to make a billable OpenAI call")

    answer = AIService.from_environment().generate_text(
        "What is 2+2? Reply with only the number."
    )

    assert "4" in answer
