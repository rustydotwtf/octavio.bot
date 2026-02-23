export type AssistantTransportMode = "polling" | "webhook";

const defaultAssistantDbPath =
  process.env.HOME && process.env.HOME.length > 0
    ? `${process.env.HOME}/.octavio/assistant.sqlite`
    : ".octavio/assistant.sqlite";

export const settings = {
  assistant: {
    databasePath: defaultAssistantDbPath,
    debugLogMb: 64,
    model: "zai/glm-5",
  },
  assistantApi: {
    host: "127.0.0.1",
    port: 4100,
  },
  assistantTelegram: {
    allowedChatIds: [] as number[],
    mode: "polling" as AssistantTransportMode,
    pollIdleDelayMs: 300,
    pollTimeoutSeconds: 30,
    port: 4200,
    setWebhookOnStartup: false,
    webhookUrl: undefined as string | undefined,
  },
} as const;
