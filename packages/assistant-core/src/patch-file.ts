import { patchFileInput } from "./types";
import type { PatchFileInput } from "./types";

const toAbsolutePath = (workspaceDirectory: string, filePath: string): string =>
  filePath.startsWith("/")
    ? filePath
    : `${workspaceDirectory.replace(/\/$/u, "")}/${filePath}`;

const replaceFirst = (
  value: string,
  find: string,
  replace: string
): { replacements: number; result: string } => {
  const index = value.indexOf(find);
  if (index === -1) {
    return { replacements: 0, result: value };
  }

  return {
    replacements: 1,
    result: `${value.slice(0, index)}${replace}${value.slice(index + find.length)}`,
  };
};

const replaceAll = (
  value: string,
  find: string,
  replace: string
): { replacements: number; result: string } => {
  if (find.length === 0) {
    return { replacements: 0, result: value };
  }

  let cursor = 0;
  let replacements = 0;
  let output = "";

  while (cursor < value.length) {
    const index = value.indexOf(find, cursor);
    if (index === -1) {
      output += value.slice(cursor);
      break;
    }

    output += `${value.slice(cursor, index)}${replace}`;
    cursor = index + find.length;
    replacements += 1;
  }

  return { replacements, result: output };
};

export const runPatchFileTool = async (
  input: PatchFileInput,
  workspaceDirectory: string
): Promise<{ changed: boolean; path: string; replacements: number }> => {
  const parsed = patchFileInput.parse(input);
  if (parsed.find.length === 0) {
    throw new Error("patch_file requires a non-empty 'find' value.");
  }

  const path = toAbsolutePath(workspaceDirectory, parsed.path);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`File does not exist: ${path}`);
  }

  const text = await file.text();
  const replaced =
    parsed.occurrence === "all"
      ? replaceAll(text, parsed.find, parsed.replace)
      : replaceFirst(text, parsed.find, parsed.replace);

  if (replaced.replacements > 0) {
    await Bun.write(path, replaced.result);
  }

  return {
    changed: replaced.replacements > 0,
    path,
    replacements: replaced.replacements,
  };
};
