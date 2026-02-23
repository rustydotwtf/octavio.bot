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

  it("searches memory titles and bodies with ranking", () => {
    const store = new MemoryStore(createDbPath());

    store.saveMemory({
      bodyMarkdown: "Body-only reference to roadmap discovery work.",
      title: "release-notes",
    });
    store.saveMemory({
      bodyMarkdown: "Planning details for next quarter.",
      title: "roadmap-v2",
    });
    store.saveMemory({
      bodyMarkdown: "Canonical roadmap memory.",
      title: "roadmap",
    });

    const matches = store.searchMemories("roadmap", 10);

    expect(matches).toHaveLength(3);
    expect(matches[0]?.title).toBe("roadmap");
    expect(matches[1]?.title).toBe("roadmap-v2");
    expect(matches[2]?.title).toBe("release-notes");
    expect(matches[2]?.snippet.toLowerCase()).toContain("roadmap");
  });

  it("searches case-insensitively and respects limits", () => {
    const store = new MemoryStore(createDbPath());

    store.saveMemory({
      bodyMarkdown: "alpha body",
      title: "User Preferences",
    });
    store.saveMemory({
      bodyMarkdown: "beta body",
      title: "user-profile",
    });

    const limited = store.searchMemories("USER", 1);

    expect(limited).toHaveLength(1);
    expect(limited[0]?.title.toLowerCase()).toContain("user");
  });

  it("lists memories with stable pagination metadata", () => {
    const store = new MemoryStore(createDbPath());

    store.saveMemory({
      bodyMarkdown: "first entry",
      title: "alpha",
    });
    store.saveMemory({
      bodyMarkdown: "second entry",
      title: "beta",
    });
    store.saveMemory({
      bodyMarkdown: "third entry",
      title: "gamma",
    });

    const firstPage = store.listMemoriesPage(1, 2);
    const secondPage = store.listMemoriesPage(2, 2);

    expect(firstPage.totalCount).toBe(3);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.hasNextPage).toBeTrue();
    expect(firstPage.memories).toHaveLength(2);
    expect(firstPage.memories[0]?.title).toBe("gamma");
    expect(firstPage.memories[1]?.title).toBe("beta");

    expect(secondPage.totalCount).toBe(3);
    expect(secondPage.totalPages).toBe(2);
    expect(secondPage.hasNextPage).toBeFalse();
    expect(secondPage.memories).toHaveLength(1);
    expect(secondPage.memories[0]?.title).toBe("alpha");
  });
});
