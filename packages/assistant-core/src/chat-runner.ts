import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText } from "ai";

import type { ChatStore } from "./db";
import { buildAssistantTools } from "./tools";
import type { ChatRequestInput } from "./types";

const DEFAULT_MODEL = "gpt-4o-mini";

interface AssistantRunnerOptions {
  defaultModel?: string;
  store: ChatStore;
  workspaceDirectory: string;
}

const parseMessageText = (contentJson: string): string => {
  try {
    const parsed = JSON.parse(contentJson) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
};

export class AssistantRunner {
  private readonly defaultModel: string;
  private readonly openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  private readonly store: ChatStore;
  private readonly workspaceDirectory: string;

  public constructor(options: AssistantRunnerOptions) {
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
    this.store = options.store;
    this.workspaceDirectory = options.workspaceDirectory;
  }

  public run(input: ChatRequestInput): {
    conversationId: string;
    response: Response;
  } {
    const conversationId =
      input.conversationId && input.conversationId.trim().length > 0
        ? input.conversationId
        : crypto.randomUUID();

    this.store.ensureConversation(conversationId);
    this.store.saveMessage({
      conversationId,
      id: crypto.randomUUID(),
      role: "user",
      text: input.message,
    });

    const storedMessages = this.store.listMessages(conversationId);
    const modelMessages = storedMessages.map((message) => ({
      content: parseMessageText(message.contentJson),
      role: message.role,
    }));

    const result = streamText({
      messages: modelMessages,
      model: this.openai(input.model ?? this.defaultModel),
      onFinish: ({ text }) => {
        this.store.saveMessage({
          conversationId,
          id: crypto.randomUUID(),
          role: "assistant",
          text,
        });
      },
      stopWhen: stepCountIs(6),
      system:
        "You are a practical assistant. Use tools when you need file data or file updates. Keep responses concise.",
      tools: buildAssistantTools({
        conversationId,
        store: this.store,
        workspaceDirectory: this.workspaceDirectory,
      }),
    });

    const response = result.toTextStreamResponse();
    response.headers.set("x-conversation-id", conversationId);

    return {
      conversationId,
      response,
    };
  }
}
