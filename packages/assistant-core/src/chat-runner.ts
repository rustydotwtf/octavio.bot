import { gateway } from "@ai-sdk/gateway";
import { stepCountIs, streamText, wrapLanguageModel } from "ai";

import type { ChatStore } from "./db";
import { buildAssistantTools } from "./tools";
import type { ChatRequestInput } from "./types";

const DEFAULT_MODEL = "openai/gpt-5-mini";
const DEFAULT_CHANNEL = "api";

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

const toErrorPayload = (error: unknown): { message: string; name?: string } => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return {
    message: String(error),
  };
};

const getChunkStepId = (chunk: unknown): string | undefined => {
  if (!chunk || typeof chunk !== "object") {
    return undefined;
  }

  const value = (chunk as { id?: unknown }).id;
  return typeof value === "string" ? value : undefined;
};

export class AssistantRunner {
  private readonly defaultModel: string;
  private readonly gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
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

    const modelName = input.model ?? this.defaultModel;
    const requestId = crypto.randomUUID();

    const wrappedModel = wrapLanguageModel({
      middleware: {
        transformParams: ({ params }) => {
          this.store.appendDebugEvent({
            channel,
            conversationId,
            eventType: "llm.transform-params",
            model: modelName,
            payload: params,
            requestId,
            source: "llm-middleware",
          });

          return Promise.resolve({
            ...params,
            providerOptions: {
              ...params.providerOptions,
              octavioDebug: {
                channel,
                conversationId,
                requestId,
              },
            },
          });
        },
        wrapGenerate: async ({ doGenerate, params }) => {
          const startMs = Date.now();
          this.store.appendDebugEvent({
            channel,
            conversationId,
            eventType: "llm.generate.start",
            model: modelName,
            payload: params,
            requestId,
            source: "llm-middleware",
          });

          try {
            const result = await doGenerate();
            this.store.appendDebugEvent({
              channel,
              conversationId,
              eventType: "llm.generate.finish",
              model: modelName,
              payload: {
                content: result.content,
                durationMs: Date.now() - startMs,
                finishReason: result.finishReason,
                response: result.response,
                usage: result.usage,
                warnings: result.warnings,
              },
              requestId,
              source: "llm-middleware",
            });
            return result;
          } catch (error: unknown) {
            this.store.appendDebugEvent({
              channel,
              conversationId,
              eventType: "llm.generate.error",
              model: modelName,
              payload: {
                durationMs: Date.now() - startMs,
                error: toErrorPayload(error),
              },
              requestId,
              source: "llm-middleware",
            });
            throw error;
          }
        },
        wrapStream: async ({ doStream, params }) => {
          const startMs = Date.now();
          this.store.appendDebugEvent({
            channel,
            conversationId,
            eventType: "llm.stream.start",
            model: modelName,
            payload: params,
            requestId,
            source: "llm-middleware",
          });

          try {
            const { stream, ...rest } = await doStream();
            const [clientStream, debugStream] = stream.tee();

            void (async () => {
              const reader = debugStream.getReader();
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    break;
                  }

                  const stepId = getChunkStepId(value);
                  this.store.appendDebugEvent({
                    channel,
                    conversationId,
                    eventType: "llm.stream.chunk",
                    model: modelName,
                    payload: value,
                    requestId,
                    source: "llm-middleware",
                    stepId,
                  });
                }

                this.store.appendDebugEvent({
                  channel,
                  conversationId,
                  eventType: "llm.stream.finish",
                  model: modelName,
                  payload: {
                    durationMs: Date.now() - startMs,
                  },
                  requestId,
                  source: "llm-middleware",
                });
              } catch (error: unknown) {
                this.store.appendDebugEvent({
                  channel,
                  conversationId,
                  eventType: "llm.stream.error",
                  model: modelName,
                  payload: {
                    durationMs: Date.now() - startMs,
                    error: toErrorPayload(error),
                  },
                  requestId,
                  source: "llm-middleware",
                });
              } finally {
                reader.releaseLock();
              }
            })();

            return {
              ...rest,
              stream: clientStream,
            };
          } catch (error: unknown) {
            this.store.appendDebugEvent({
              channel,
              conversationId,
              eventType: "llm.stream.error",
              model: modelName,
              payload: {
                durationMs: Date.now() - startMs,
                error: toErrorPayload(error),
              },
              requestId,
              source: "llm-middleware",
            });
            throw error;
          }
        },
      },
      model: gateway(modelName),
    });

    this.store.appendDebugEvent({
      channel,
      conversationId,
      eventType: "assistant.run.start",
      model: modelName,
      payload: {
        messageLength: trimmedMessage.length,
      },
      requestId,
      source: "assistant-runner",
    });

    const result = streamText({
      messages: modelMessages,
      model: wrappedModel,
      onError: ({ error }) => {
        this.store.appendDebugEvent({
          channel,
          conversationId,
          eventType: "assistant.run.error",
          model: modelName,
          payload: {
            error: toErrorPayload(error),
          },
          requestId,
          source: "assistant-runner",
        });
      },
      onFinish: ({
        finishReason,
        steps,
        text,
        totalUsage,
        usage,
        warnings,
      }) => {
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

        this.store.appendDebugEvent({
          channel,
          conversationId,
          eventType: "assistant.run.finish",
          model: modelName,
          payload: {
            finishReason,
            stepCount: steps.length,
            totalUsage,
            usage,
            warnings,
          },
          requestId,
          source: "assistant-runner",
        });
      },
      onStepFinish: (event) => {
        this.store.appendDebugEvent({
          channel,
          conversationId,
          eventType: "assistant.step.finish",
          model: modelName,
          payload: event,
          requestId,
          source: "assistant-runner",
          stepId: event.response?.id,
        });
      },
      providerOptions: {
        octavioDebug: {
          channel,
          conversationId,
          requestId,
        },
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
