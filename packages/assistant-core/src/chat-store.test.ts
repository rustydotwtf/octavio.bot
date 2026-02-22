import { afterEach, describe, expect, it } from "bun:test";

import { AssistantRunner } from "./chat-runner";
import { ChatStore } from "./db";

const createdDbPaths: string[] = [];

const createDbPath = (): string => {
  const dbPath = `/tmp/octavio-assistant-store-${crypto.randomUUID()}.sqlite`;
  createdDbPaths.push(dbPath);
  return dbPath;
};

afterEach(async () => {
  for (const dbPath of createdDbPaths) {
    for (const suffix of ["", "-shm", "-wal"]) {
      try {
        await Bun.file(`${dbPath}${suffix}`).delete();
      } catch {
        // Cleanup is best-effort.
      }
    }
  }

  createdDbPaths.length = 0;
});

describe("chat store active conversation", () => {
  it("persists active conversation id across store instances", () => {
    const dbPath = createDbPath();

    const firstStore = new ChatStore(dbPath);
    const initialConversationId = firstStore.resolveActiveConversationId();

    expect(firstStore.getActiveConversationId()).toBe(initialConversationId);

    const secondStore = new ChatStore(dbPath);
    expect(secondStore.getActiveConversationId()).toBe(initialConversationId);
    expect(secondStore.resolveActiveConversationId()).toBe(
      initialConversationId
    );
  });

  it("rotates active conversation when starting a new one", () => {
    const dbPath = createDbPath();
    const store = new ChatStore(dbPath);

    const firstConversationId = store.resolveActiveConversationId();
    const secondConversationId = store.startNewConversation();

    expect(secondConversationId).not.toBe(firstConversationId);
    expect(store.getActiveConversationId()).toBe(secondConversationId);
  });

  it("stores channel metadata on saved messages", () => {
    const dbPath = createDbPath();
    const store = new ChatStore(dbPath);
    const conversationId = store.resolveActiveConversationId();

    store.saveMessage({
      channel: "telegram",
      conversationId,
      id: crypto.randomUUID(),
      metadataJson: JSON.stringify({ chatId: "123" }),
      role: "user",
      text: "hello",
    });

    const [message] = store.listMessages(conversationId);
    expect(message?.channel).toBe("telegram");
    expect(message?.metadataJson).toBe('{"chatId":"123"}');
  });
});

describe("assistant runner /new command", () => {
  it("returns a plain confirmation and updates active conversation", async () => {
    const dbPath = createDbPath();
    const store = new ChatStore(dbPath);
    const runner = new AssistantRunner({
      defaultModel: "openai/gpt-5-mini",
      store,
      workspaceDirectory: process.cwd(),
    });

    const result = runner.run({
      message: " /new ",
    });

    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toBe("Started a new conversation.");
    expect(result.response.headers.get("x-conversation-id")).toBe(
      result.conversationId
    );
    expect(store.getActiveConversationId()).toBe(result.conversationId);
    expect(store.listMessages(result.conversationId)).toHaveLength(0);
  });
});
