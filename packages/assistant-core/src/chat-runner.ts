import { createOpenAI } from "@ai-sdk/openai";
import { stepCountIs, streamText } from "ai";

import type { ChatStore } from "./db";
import { buildAssistantTools } from "./tools";
import type { ChatRequestInput } from "./types";

const DEFAULT_MODEL = "openai/gpt-5-mini";
const DEFAULT_CHANNEL = "api";
const DEFAULT_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

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

const toOptionalJson = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "Unable to serialize value" });
  }
};

export class AssistantRunner {
  private readonly defaultModel: string;
  private readonly gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  private readonly openai = createOpenAI({
    apiKey: process.env.AI_GATEWAY_API_KEY,
    baseURL: process.env.AI_GATEWAY_BASE_URL ?? DEFAULT_GATEWAY_BASE_URL,
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
    const trimmedMessage = input.message.trim();
    const channel = input.channel ?? DEFAULT_CHANNEL;

    if (trimmedMessage === "/new") {
      const conversationId = this.store.startNewConversation();
      const response = new Response("Started a new conversation.", {
        status: 200,
      });
      response.headers.set("x-conversation-id", conversationId);

      return {
        conversationId,
        response,
      };
    }

    if (!this.gatewayApiKey || this.gatewayApiKey.length === 0) {
      throw new Error("Missing AI_GATEWAY_API_KEY environment variable.");
    }

    const conversationId = this.store.resolveActiveConversationId();

    this.store.ensureConversation(conversationId);
    this.store.saveMessage({
      channel,
      conversationId,
      id: crypto.randomUUID(),
      metadataJson: input.messageMetadata
        ? toOptionalJson(input.messageMetadata)
        : undefined,
      role: "user",
      text: trimmedMessage,
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
          channel,
          conversationId,
          id: crypto.randomUUID(),
          metadataJson: input.channelMetadata
            ? toOptionalJson(input.channelMetadata)
            : undefined,
          role: "assistant",
          text,
        });
      },
      stopWhen: stepCountIs(6),
      system:
        "You are a practical assistant. Use tools when you need file data or file updates. Keep responses concise.",
      tools: buildAssistantTools({
        channel,
        channelMetadata: input.channelMetadata,
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
