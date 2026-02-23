import { afterEach, describe, expect, it } from "bun:test";

import { MemoryStore } from "./memory-db";
import { runSearchMemoryTool } from "./search-memory";

const createdDbPaths: string[] = [];

const createDbPath = (): string => {
  const dbPath = `/tmp/octavio-search-memory-${crypto.randomUUID()}.sqlite`;
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

describe("search_memory tool", () => {
  it("returns concise markdown snippets for matching memories", () => {
    const store = new MemoryStore(createDbPath());
    store.saveMemory({
      bodyMarkdown:
        "Remember: deployment runbook requires migrations before rolling restart.",
      title: "deploy-runbook",
    });

    const result = runSearchMemoryTool(
      {
        limit: 5,
        query: "deploy",
      },
      store
    );

    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.summaryMarkdown).toContain(
      "Found 1 memory match(es) for `deploy`."
    );
    expect(result.summaryMarkdown).toContain("**deploy-runbook**");
    expect(result.summaryMarkdown).toContain(
      "Use `get_memory` with an exact title"
    );
  });

  it("returns a guidance message when no memories match", () => {
    const store = new MemoryStore(createDbPath());

    const result = runSearchMemoryTool(
      {
        limit: 5,
        query: "does-not-exist",
      },
      store
    );

    expect(result.count).toBe(0);
    expect(result.summaryMarkdown).toContain(
      "Found 0 memory match(es) for `does-not-exist`."
    );
    expect(result.summaryMarkdown).toContain(
      "Use `get_memory` with an exact title"
    );
  });
});
