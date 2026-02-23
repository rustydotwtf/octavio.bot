const toForwardSlashes = (value: string): string => value.split("\\").join("/");

const normalizeAbsolutePath = (value: string): string => {
  const normalizedInput = toForwardSlashes(value);
  const isAbsolutePath = normalizedInput.startsWith("/");
  const parts = normalizedInput.split("/");
  const output: string[] = [];

  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    }

    if (part === "..") {
      if (output.length > 0) {
        output.pop();
      } else if (!isAbsolutePath) {
        output.push("..");
      }
      continue;
    }

    output.push(part);
  }

  const normalizedPath = `${isAbsolutePath ? "/" : ""}${output.join("/")}`;
  if (normalizedPath.length > 0) {
    return normalizedPath;
  }

  if (isAbsolutePath) {
    return "/";
  }

  return ".";
};

const toAbsolutePath = (
  workspaceDirectory: string,
  inputPath: string
): string => {
  const normalizedWorkspace = toForwardSlashes(workspaceDirectory);
  const normalizedInput = toForwardSlashes(inputPath);

  if (normalizedInput.startsWith("/")) {
    return normalizeAbsolutePath(normalizedInput);
  }

  if (normalizedWorkspace.startsWith("/")) {
    return normalizeAbsolutePath(
      `${normalizedWorkspace.replace(/\/$/u, "")}/${normalizedInput}`
    );
  }

  return normalizeAbsolutePath(
    `${process.cwd().replace(/\/$/u, "")}/${normalizedWorkspace}/${normalizedInput}`
  );
};

const isPathInsideWorkspace = (
  workspaceDirectory: string,
  resolvedPath: string
): boolean => {
  const normalizedWorkspace = normalizeAbsolutePath(workspaceDirectory);
  const normalizedPath = normalizeAbsolutePath(resolvedPath);

  if (normalizedWorkspace === "/") {
    return true;
  }

  return (
    normalizedPath === normalizedWorkspace ||
    normalizedPath.startsWith(`${normalizedWorkspace}/`)
  );
};

export const resolveWorkspacePath = (
  workspaceDirectory: string,
  inputPath: string
): string => {
  const resolvedWorkspaceDirectory = toAbsolutePath(
    process.cwd(),
    workspaceDirectory
  );
  const resolvedPath = toAbsolutePath(resolvedWorkspaceDirectory, inputPath);

  if (!isPathInsideWorkspace(resolvedWorkspaceDirectory, resolvedPath)) {
    throw new Error(`Path escapes workspace directory: ${inputPath}`);
  }

  return resolvedPath;
};
