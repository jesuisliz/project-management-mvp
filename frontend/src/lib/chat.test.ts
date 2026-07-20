import { getBoundedChatHistory } from "@/lib/chat";

describe("getBoundedChatHistory", () => {
  it("sends only the latest 20 session-local messages", () => {
    const messages = Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `Message ${index + 1}`,
    }));

    const history = getBoundedChatHistory(messages);

    expect(history).toHaveLength(20);
    expect(history[0].content).toBe("Message 5");
    expect(history[19].content).toBe("Message 24");
  });
});
