import { afterEach, describe, expect, it } from "bun:test";

import { MemoryStore } from "./memory-db";

const createdDbPaths: string[] = [];

const createDbPath = (): string => {
  const dbPath = `/tmp/octavio-memory-store-${crypto.randomUUID()}.sqlite`;
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

describe("memory store", () => {
  it("stores duplicate titles as separate rows", () => {
    const store = new MemoryStore(createDbPath());

    const first = store.saveMemory({
      bodyMarkdown: "First version",
      title: "user-preference",
    });
    const second = store.saveMemory({
      bodyMarkdown: "Second version",
      title: "user-preference",
    });

    const entries = store.listMemoriesByTitle("user-preference", 10);

    expect(entries).toHaveLength(2);
    expect(first.joyfulId).not.toBe(second.joyfulId);
    expect(entries[0]?.bodyMarkdown).toBe("Second version");
    expect(entries[1]?.bodyMarkdown).toBe("First version");
  });

  it("persists records across store instances", () => {
    const dbPath = createDbPath();

    const firstStore = new MemoryStore(dbPath);
    firstStore.saveMemory({
      bodyMarkdown: "Persistent memory",
      title: "persistence-check",
    });

    const secondStore = new MemoryStore(dbPath);
    const entries = secondStore.listMemoriesByTitle("persistence-check", 5);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe("persistence-check");
    expect(entries[0]?.bodyMarkdown).toBe("Persistent memory");
  });

  it("generates unique joyful ids across multiple inserts", () => {
    const store = new MemoryStore(createDbPath());
    const joyfulIds = new Set<string>();

    for (let index = 0; index < 25; index += 1) {
      const memory = store.saveMemory({
        bodyMarkdown: `entry-${index}`,
        title: "id-uniqueness-check",
      });
      joyfulIds.add(memory.joyfulId);
    }

    expect(joyfulIds.size).toBe(25);
  });
});
