import { afterEach, describe, expect, it } from "bun:test";

import { runListMemoriesTool } from "./list-memories";
import { MemoryStore } from "./memory-db";

const createdDbPaths: string[] = [];

const createDbPath = (): string => {
  const dbPath = `/tmp/octavio-list-memories-${crypto.randomUUID()}.sqlite`;
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

describe("list_memories tool", () => {
  it("returns paginated markdown output with continuation hints", () => {
    const store = new MemoryStore(createDbPath());
    store.saveMemory({
      bodyMarkdown: "Alpha body",
      title: "alpha",
    });
    store.saveMemory({
      bodyMarkdown: "Beta body",
      title: "beta",
    });
    store.saveMemory({
      bodyMarkdown: "Gamma body",
      title: "gamma",
    });

    const result = runListMemoriesTool(
      {
        limit: 2,
        page: 1,
      },
      store
    );

    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
    expect(result.count).toBe(2);
    expect(result.totalCount).toBe(3);
    expect(result.totalPages).toBe(2);
    expect(result.hasNextPage).toBeTrue();
    expect(result.summaryMarkdown).toContain("Memories page 1/2");
    expect(result.summaryMarkdown).toContain("**gamma**");
    expect(result.summaryMarkdown).toContain(
      "Use `list_memories` with `page=2` to continue."
    );
    expect(result.summaryMarkdown).toContain(
      "Use `get_memory` with an exact title"
    );
  });

  it("returns an empty-state markdown message", () => {
    const store = new MemoryStore(createDbPath());

    const result = runListMemoriesTool(
      {
        limit: 10,
        page: 1,
      },
      store
    );

    expect(result.count).toBe(0);
    expect(result.totalCount).toBe(0);
    expect(result.summaryMarkdown).toContain("No memories saved yet.");
  });
});
