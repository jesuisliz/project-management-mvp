import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSidebar } from "@/components/ChatSidebar";

const defaultProps = {
  messages: [],
  isSending: false,
  isBoardBusy: false,
  error: null,
  onClose: vi.fn(),
  onSend: vi.fn().mockResolvedValue(true),
};

describe("ChatSidebar", () => {
  beforeEach(() => {
    defaultProps.onClose.mockReset();
    defaultProps.onSend.mockReset().mockResolvedValue(true);
  });

  it("renders the empty state and accessible composer", () => {
    render(<ChatSidebar {...defaultProps} />);

    expect(screen.getByText("What should we change?")).toBeVisible();
    expect(screen.getByLabelText("Message AI assistant")).toBeVisible();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("sends with Enter and clears the successful draft", async () => {
    render(<ChatSidebar {...defaultProps} />);
    const composer = screen.getByLabelText("Message AI assistant");

    await userEvent.type(composer, "What is next?{enter}");

    await waitFor(() =>
      expect(defaultProps.onSend).toHaveBeenCalledWith("What is next?")
    );
    expect(composer).toHaveValue("");
  });

  it("keeps the draft after a failed request", async () => {
    defaultProps.onSend.mockResolvedValueOnce(false);
    render(<ChatSidebar {...defaultProps} error="Please try again." />);
    const composer = screen.getByLabelText("Message AI assistant");

    await userEvent.type(composer, "Keep this message");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(defaultProps.onSend).toHaveBeenCalledOnce());
    expect(composer).toHaveValue("Keep this message");
    expect(screen.getByRole("alert")).toHaveTextContent("Please try again.");
  });

  it("renders conversation roles and disables duplicate sends", () => {
    render(
      <ChatSidebar
        {...defaultProps}
        messages={[
          { role: "user", content: "Move the roadmap card." },
          { role: "assistant", content: "Moved it to Review." },
        ]}
        isSending
      />
    );

    expect(screen.getByText("Move the roadmap card.")).toBeVisible();
    expect(screen.getByText("Moved it to Review.")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Assistant is working"
    );
    expect(screen.getByLabelText("Message AI assistant")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sending..." })).toBeDisabled();
  });
});
