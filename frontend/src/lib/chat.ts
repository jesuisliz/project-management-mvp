export const MAX_CHAT_HISTORY = 20;

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export const getBoundedChatHistory = (messages: ChatMessage[]) =>
  messages.slice(-MAX_CHAT_HISTORY);
