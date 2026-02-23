import type { MemoryStore } from "./memory-db";
import { searchMemoryInput } from "./types";
import type { SearchMemoryInput } from "./types";

interface SearchMemoryMatch {
  createdAt: string;
  joyfulId: string;
  snippet: string;
  title: string;
}

interface SearchMemoryToolResult {
  count: number;
  query: string;
  results: SearchMemoryMatch[];
  summaryMarkdown: string;
}

const toSummaryMarkdown = (
  query: string,
  results: SearchMemoryMatch[]
): string => {
  if (results.length === 0) {
    return `Found 0 memory match(es) for \`${query}\`.\n\nUse \`get_memory\` with an exact title to read full memory bodies.`;
  }

  const header = `Found ${results.length} memory match(es) for \`${query}\`.`;
  const bullets = results.map(
    ({ joyfulId, snippet, title }) =>
      `- **${title}** (\`${joyfulId}\`) - ${snippet}`
  );

  return [
    header,
    ...bullets,
    "",
    "Use `get_memory` with an exact title to read full memory bodies.",
  ].join("\n");
};

export const runSearchMemoryTool = (
  input: SearchMemoryInput,
  memoryStore: MemoryStore
): SearchMemoryToolResult => {
  const parsed = searchMemoryInput.parse(input);
  const results = memoryStore.searchMemories(parsed.query, parsed.limit);

  return {
    count: results.length,
    query: parsed.query,
    results,
    summaryMarkdown: toSummaryMarkdown(parsed.query, results),
  };
};
