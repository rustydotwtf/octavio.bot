import {
  AssistantRunner,
  ChatStore,
  chatRequestInput,
} from "@octavio.bot/assistant-core";
import { Elysia } from "elysia";

const DEFAULT_PORT = 4100;
const DEFAULT_DB_PATH = ".octavio/assistant.sqlite";

const parsePort = (value: string | undefined): number => {
  if (!value) {
    return DEFAULT_PORT;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_PORT;
  }

  return parsed;
};

const databasePath = process.env.ASSISTANT_DB_PATH ?? DEFAULT_DB_PATH;
const store = new ChatStore(databasePath);
const runner = new AssistantRunner({
  defaultModel: process.env.ASSISTANT_MODEL,
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

    const run = runner.run(parsed.data);
    return run.response;
  });

const port = parsePort(process.env.PORT);
app.listen(port);

process.stdout.write(`assistant-api listening on http://localhost:${port}\n`);
