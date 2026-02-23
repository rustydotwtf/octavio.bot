import {
  AssistantRunner,
  ChatStore,
  MemoryStore,
} from "@octavio.bot/assistant-core";
import { Elysia } from "elysia";

const { settings } = await import(
  new URL("../../../settings.ts", import.meta.url).toString()
);

const POLL_OFFSET_STATE_KEY = "telegram_poll_offset";
const EMPTY_RESPONSE_MESSAGE = "I couldn't generate a reply. Please try again.";
const ERROR_RESPONSE_MESSAGE =
  "I hit an error while generating a reply. Please try again.";

type TelegramMode = "polling" | "webhook";

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

const { assistant, assistantTelegram } = settings;

const store = new ChatStore(assistant.databasePath, {
  debugLogMb: assistant.debugLogMb,
});
const memoryStore = new MemoryStore(assistant.memoryDatabasePath);
const runner = new AssistantRunner({
  defaultModel: assistant.model,
  memoryStore,
  store,
  workspaceDirectory: process.cwd(),
});

const {
  allowedChatIds: configuredAllowedChatIds,
  mode,
  pollIdleDelayMs,
  pollTimeoutSeconds,
  port: webhookPort,
  setWebhookOnStartup: shouldSetWebhook,
  webhookUrl,
} = assistantTelegram;

const allowedChatIds =
  configuredAllowedChatIds.length > 0
    ? new Set(configuredAllowedChatIds)
    : null;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const telegramMode: TelegramMode = mode;

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

  let replyText = EMPTY_RESPONSE_MESSAGE;

  try {
    const generatedResponseText = await run.response.text();
    const generatedText = generatedResponseText.trim();
    if (generatedText.length > 0) {
      replyText = generatedText;
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `assistant reply error (chat=${chatId}, update=${updateId}): ${errorMessage}\n`
    );
    replyText = ERROR_RESPONSE_MESSAGE;
  }

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
      "settings.assistantTelegram.webhookUrl is required when setWebhookOnStartup=true."
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

  app.listen(webhookPort);
  process.stdout.write(
    `assistant-telegram webhook mode listening on http://localhost:${webhookPort}\n`
  );
};

if (shouldSetWebhook) {
  await configureWebhook();
  process.stdout.write("assistant-telegram webhook configured\n");
}

if (telegramMode === "webhook") {
  runWebhook();
} else {
  await runPolling();
}
