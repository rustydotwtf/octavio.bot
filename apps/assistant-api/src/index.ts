import {
  AssistantRunner,
  ChatStore,
  chatRequestInput,
} from "@octavio.bot/assistant-core";
import { Elysia } from "elysia";

const { settings } = await import(
  new URL("../../../settings.ts", import.meta.url).toString()
);

const { assistant, assistantApi } = settings;

const store = new ChatStore(assistant.databasePath, {
  debugLogMb: assistant.debugLogMb,
});
const runner = new AssistantRunner({
  defaultModel: assistant.model,
  store,
  workspaceDirectory: process.cwd(),
});

const app = new Elysia()
  .get("/health", () => ({ ok: true }))
  .get("/conversations/:id/messages", ({ params, set }) => {
    const conversationId = params.id;
    if (!conversationId || conversationId.length === 0) {
      set.status = 400;
      return { error: "Conversation id is required." };
    }

    return {
      conversationId,
      messages: store.listMessages(conversationId),
    };
  })
  .post("/chat", ({ body, set }) => {
    const parsed = chatRequestInput.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return {
        error: "Invalid chat request.",
        issues: parsed.error.issues,
      };
    }

    const request = parsed.data;
    const { channel, ...rest } = request;

    const run = runner.run({
      ...rest,
      channel: channel ?? "api",
    });
    return run.response;
  });

const { host, port } = assistantApi;
app.listen({ hostname: host, port });

process.stdout.write(`assistant-api listening on http://${host}:${port}\n`);
