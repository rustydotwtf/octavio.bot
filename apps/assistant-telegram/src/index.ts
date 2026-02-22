import { AssistantRunner, ChatStore } from "@octavio.bot/assistant-core";
import { Elysia } from "elysia";

const DEFAULT_PORT = 4200;
const DEFAULT_DB_PATH = ".octavio/assistant.sqlite";
const DEFAULT_POLL_TIMEOUT_SECONDS = 30;
const DEFAULT_POLL_IDLE_DELAY_MS = 300;
const POLL_OFFSET_STATE_KEY = "telegram_poll_offset";

type TelegramMode = "auto" | "polling" | "webhook";

interface TelegramMessage {
  chat: {
    id: number;
  };
  from?: {
    id?: number;
    username?: string;
  };
  message_id: number;
  text?: string;
}

interface TelegramUpdate {
  message?: TelegramMessage;
  update_id: number;
}

const parseNumber = (
  value: string | undefined,
  fallback: number,
  minValue: number
): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < minValue) {
    return fallback;
  }

  return parsed;
};

const parseBoolean = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }

  return value === "1" || value.toLowerCase() === "true";
};

const parseAllowedChatIds = (value: string | undefined): Set<number> | null => {
  if (!value) {
    return null;
  }

  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => !Number.isNaN(item));

  if (values.length === 0) {
    return null;
  }

  return new Set(values);
};

const parseMode = (
  value: string | undefined,
  webhookUrl: string | undefined
): TelegramMode => {
  if (!value || value === "auto") {
    return webhookUrl ? "webhook" : "polling";
  }

  if (value === "polling" || value === "webhook") {
    return value;
  }

  return webhookUrl ? "webhook" : "polling";
};

const readBodyText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return "";
  }
};

const delay = async (ms: number): Promise<void> => {
  await Bun.sleep(ms);
};

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN environment variable.");
}

const databasePath = process.env.ASSISTANT_DB_PATH ?? DEFAULT_DB_PATH;
const store = new ChatStore(databasePath);
const runner = new AssistantRunner({
  defaultModel: process.env.ASSISTANT_MODEL,
  store,
  workspaceDirectory: process.cwd(),
});

const allowedChatIds = parseAllowedChatIds(
  process.env.TELEGRAM_ALLOWED_CHAT_IDS
);
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const mode = parseMode(process.env.TELEGRAM_MODE, webhookUrl);
const shouldSetWebhook = parseBoolean(process.env.TELEGRAM_SET_WEBHOOK);
const pollTimeoutSeconds = parseNumber(
  process.env.TELEGRAM_POLL_TIMEOUT_SECONDS,
  DEFAULT_POLL_TIMEOUT_SECONDS,
  1
);
const pollIdleDelayMs = parseNumber(
  process.env.TELEGRAM_POLL_IDLE_DELAY_MS,
  DEFAULT_POLL_IDLE_DELAY_MS,
  0
);

const telegramApiBase = `https://api.telegram.org/bot${token}`;

const telegramRequest = async <T>(
  method: string,
  body: Record<string, unknown>
): Promise<T> => {
  const response = await fetch(`${telegramApiBase}/${method}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const text = await readBodyText(response);
    throw new Error(
      `Telegram ${method} failed (${response.status}): ${text || "empty response"}`
    );
  }

  const json = (await response.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
  };

  if (!json.ok || json.result === undefined) {
    throw new Error(
      `Telegram ${method} failed: ${json.description ?? "missing result"}`
    );
  }

  return json.result;
};

const sendTelegramMessage = async (
  chatId: number,
  text: string
): Promise<void> => {
  const maxTelegramMessageLength = 3500;
  const chunks: string[] = [];

  if (text.length <= maxTelegramMessageLength) {
    chunks.push(text);
  } else {
    for (
      let offset = 0;
      offset < text.length;
      offset += maxTelegramMessageLength
    ) {
      chunks.push(text.slice(offset, offset + maxTelegramMessageLength));
    }
  }

  for (const chunk of chunks) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: chunk,
    });
  }
};

const shouldHandleChat = (chatId: number): boolean => {
  if (!allowedChatIds) {
    return true;
  }

  return allowedChatIds.has(chatId);
};

const compactAssistantText = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }

  return "Done.";
};

const processTelegramMessage = async (
  message: TelegramMessage,
  updateId: number
): Promise<void> => {
  const chatId = message.chat.id;
  const text = message.text?.trim();

  if (!shouldHandleChat(chatId)) {
    return;
  }

  if (!text) {
    await sendTelegramMessage(
      chatId,
      "I can only process text messages right now."
    );
    return;
  }

  const run = runner.run({
    channel: "telegram",
    channelMetadata: {
      chatId,
      messageId: message.message_id,
      updateId,
      userId: message.from?.id,
      username: message.from?.username,
    },
    message: text,
    messageMetadata: {
      telegramMessageId: message.message_id,
      telegramUpdateId: updateId,
      userId: message.from?.id,
      username: message.from?.username,
    },
  });

  const replyText = compactAssistantText(await run.response.text());
  await sendTelegramMessage(chatId, replyText);
};

const processUpdate = async (update: TelegramUpdate): Promise<void> => {
  if (!update.message) {
    return;
  }

  await processTelegramMessage(update.message, update.update_id);
};

const configureWebhook = async (): Promise<void> => {
  if (!webhookUrl) {
    throw new Error(
      "TELEGRAM_WEBHOOK_URL is required when TELEGRAM_SET_WEBHOOK=true."
    );
  }

  await telegramRequest("setWebhook", {
    secret_token: webhookSecret,
    url: webhookUrl,
  });
};

const runPolling = async (): Promise<void> => {
  process.stdout.write(
    `assistant-telegram polling mode (timeout=${pollTimeoutSeconds}s)\n`
  );

  let offset = Number.parseInt(
    store.getAppStateValue(POLL_OFFSET_STATE_KEY) ?? "0",
    10
  );
  if (Number.isNaN(offset) || offset < 0) {
    offset = 0;
  }

  let consecutiveErrorCount = 0;

  while (true) {
    try {
      const updates = await telegramRequest<TelegramUpdate[]>("getUpdates", {
        allowed_updates: ["message"],
        offset,
        timeout: pollTimeoutSeconds,
      });

      for (const update of updates) {
        await processUpdate(update);
        offset = update.update_id + 1;
      }

      store.setAppStateValue(POLL_OFFSET_STATE_KEY, String(offset));
      consecutiveErrorCount = 0;

      if (updates.length === 0 && pollIdleDelayMs > 0) {
        await delay(pollIdleDelayMs);
      }
    } catch (error: unknown) {
      consecutiveErrorCount += 1;
      const waitMs = Math.min(
        5000,
        300 * 2 ** Math.min(consecutiveErrorCount, 4)
      );
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`polling error: ${message}\n`);
      await delay(waitMs);
    }
  }
};

const runWebhook = (): void => {
  if (!webhookSecret || webhookSecret.length === 0) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET is required in webhook mode.");
  }

  const port = parseNumber(process.env.PORT, DEFAULT_PORT, 1);

  const app = new Elysia()
    .get("/health", () => ({ mode: "webhook", ok: true }))
    .post("/telegram/webhook/:secret", async ({ body, params, set }) => {
      if (params.secret !== webhookSecret) {
        set.status = 403;
        return { error: "forbidden" };
      }

      const parsedBody = body as TelegramUpdate;
      await processUpdate(parsedBody);
      return { ok: true };
    });

  app.listen(port);
  process.stdout.write(
    `assistant-telegram webhook mode listening on http://localhost:${port}\n`
  );
};

if (shouldSetWebhook) {
  await configureWebhook();
  process.stdout.write("assistant-telegram webhook configured\n");
}

if (mode === "webhook") {
  runWebhook();
} else {
  await runPolling();
}
