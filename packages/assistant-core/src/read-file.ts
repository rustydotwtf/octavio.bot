import { readFileInput } from "./types";
import type { ReadFileInput } from "./types";

const toAbsolutePath = (workspaceDirectory: string, filePath: string): string =>
  filePath.startsWith("/")
    ? filePath
    : `${workspaceDirectory.replace(/\/$/u, "")}/${filePath}`;

const sliceByLine = (
  text: string,
  offset: number,
  limit: number
): { content: string; lineCount: number; truncated: boolean } => {
  const lines = text.split("\n");
  const start = Math.max(0, offset - 1);
  const selected = lines.slice(start, start + limit);
  const lineCount = selected.length;

  return {
    content: selected.join("\n"),
    lineCount,
    truncated: start + lineCount < lines.length,
  };
};

export const runReadFileTool = async (
  input: ReadFileInput,
  workspaceDirectory: string
): Promise<{
  content: string;
  lineCount: number;
  path: string;
  truncated: boolean;
}> => {
  const parsed = readFileInput.parse(input);
  const path = toAbsolutePath(workspaceDirectory, parsed.path);
  const file = Bun.file(path);

  if (!(await file.exists())) {
    throw new Error(`File does not exist: ${path}`);
  }

  const text = await file.text();
  const sliced = sliceByLine(text, parsed.offset, parsed.limit);
  return {
    ...sliced,
    path,
  };
};
