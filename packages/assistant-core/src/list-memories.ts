import type { MemoryStore } from "./memory-db";
import { listMemoryInput } from "./types";
import type { ListMemoryInput } from "./types";

interface ListMemoryMatch {
  createdAt: string;
  joyfulId: string;
  snippet: string;
  title: string;
}

interface ListMemoriesToolResult {
  count: number;
  hasNextPage: boolean;
  limit: number;
  memories: ListMemoryMatch[];
  page: number;
  summaryMarkdown: string;
  totalCount: number;
  totalPages: number;
}

const toSummaryMarkdown = (result: {
  count: number;
  hasNextPage: boolean;
  memories: ListMemoryMatch[];
  page: number;
  totalCount: number;
  totalPages: number;
}): string => {
  if (result.totalCount === 0) {
    return "No memories saved yet.\n\nUse `save_memory` to create one.";
  }

  if (result.count === 0) {
    const lastPage = Math.max(1, result.totalPages);
    return [
      `No memories found on page ${result.page}.`,
      `There are ${result.totalCount} total memory entry(ies) across ${result.totalPages} page(s).`,
      "",
      `Use \`list_memories\` with \`page=${lastPage}\` to view the last available page.`,
    ].join("\n");
  }

  const header = `Memories page ${result.page}/${Math.max(1, result.totalPages)} (${result.count} shown of ${result.totalCount} total).`;
  const bullets = result.memories.map(
    ({ createdAt, joyfulId, snippet, title }) =>
      `- **${title}** (\`${joyfulId}\`, ${createdAt}) - ${snippet}`
  );

  const lines = [header, ...bullets, ""];

  if (result.hasNextPage) {
    lines.push(
      `Use \`list_memories\` with \`page=${result.page + 1}\` to continue.`
    );
  }

  lines.push(
    "Use `get_memory` with an exact title to read full memory bodies."
  );

  return lines.join("\n");
};

export const runListMemoriesTool = (
  input: ListMemoryInput,
  memoryStore: MemoryStore
): ListMemoriesToolResult => {
  const parsed = listMemoryInput.parse(input);
  const listed = memoryStore.listMemoriesPage(parsed.page, parsed.limit);
  const result = {
    count: listed.memories.length,
    hasNextPage: listed.hasNextPage,
    limit: listed.limit,
    memories: listed.memories,
    page: listed.page,
    totalCount: listed.totalCount,
    totalPages: listed.totalPages,
  };

  return {
    ...result,
    summaryMarkdown: toSummaryMarkdown(result),
  };
};
