import { afterEach, describe, expect, it } from "bun:test";

import { AssistantRunner } from "./chat-runner";
import { ChatStore } from "./db";
import { MemoryStore } from "./memory-db";

const createdDbPaths: string[] = [];
const createdMemoryDbPaths: string[] = [];

const createDbPath = (): string => {
  const dbPath = `/tmp/octavio-assistant-store-${crypto.randomUUID()}.sqlite`;
  createdDbPaths.push(dbPath);
  return dbPath;
};

const createMemoryDbPath = (): string => {
  const dbPath = `/tmp/octavio-assistant-memory-${crypto.randomUUID()}.sqlite`;
  createdMemoryDbPaths.push(dbPath);
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

  for (const dbPath of createdMemoryDbPaths) {
    for (const suffix of ["", "-shm", "-wal"]) {
      try {
        await Bun.file(`${dbPath}${suffix}`).delete();
      } catch {
        // Cleanup is best-effort.
      }
    }
  }

  createdDbPaths.length = 0;
  createdMemoryDbPaths.length = 0;
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
    const memoryStore = new MemoryStore(createMemoryDbPath());
    const runner = new AssistantRunner({
      defaultModel: "zai/glm-5",
      memoryStore,
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

describe("debug event storage", () => {
  it("prunes oldest debug events to stay under the byte cap", () => {
    const dbPath = createDbPath();
    const store = new ChatStore(dbPath, {
      debugLogMb: 1,
    });
    const conversationId = store.resolveActiveConversationId();
    const payload = {
      text: "x".repeat(700_000),
    };

    store.appendDebugEvent({
      channel: "api",
      conversationId,
      eventType: "test.chunk",
      payload,
      requestId: "req-a",
      source: "test",
      stepId: "step-1",
    });
    store.appendDebugEvent({
      channel: "api",
      conversationId,
      eventType: "test.chunk",
      payload,
      requestId: "req-a",
      source: "test",
      stepId: "step-2",
    });
    store.appendDebugEvent({
      channel: "api",
      conversationId,
      eventType: "test.chunk",
      payload,
      requestId: "req-a",
      source: "test",
      stepId: "step-3",
    });

    const totalBytes = store.getDebugEventsTotalBytes();
    const events = store.listDebugEvents(10);

    expect(totalBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(3);
  });

  it("skips debug event writes when the cap is disabled", () => {
    const dbPath = createDbPath();
    const store = new ChatStore(dbPath, {
      debugLogMb: 0,
    });

    store.appendDebugEvent({
      eventType: "test.disabled",
      payload: { ok: true },
      requestId: "req-disabled",
      source: "test",
    });

    expect(store.getDebugEventsTotalBytes()).toBe(0);
    expect(store.listDebugEvents(10)).toHaveLength(0);
  });
});
