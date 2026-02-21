const OPEN_CODE_INSTALL_COMMAND =
  "curl -fsSL https://opencode.ai/install | bash";
const OPEN_CODE_INSTALL_COMMAND_NO_PATH =
  "curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path";

export interface OpenCodeInstallResult {
  path: string;
  version: string;
}

const ensureBinaryDirectoryOnPath = (binaryPath: string): void => {
  const directoryEnd = binaryPath.lastIndexOf("/");
  if (directoryEnd <= 0) {
    return;
  }

  const directory = binaryPath.slice(0, directoryEnd);
  const currentPath = process.env.PATH ?? "";
  const pathEntries = currentPath
    .split(":")
    .filter((entry) => entry.length > 0);
  if (pathEntries.includes(directory)) {
    return;
  }

  process.env.PATH =
    currentPath.length > 0 ? `${directory}:${currentPath}` : directory;
  process.stdout.write(`Added ${directory} to PATH for this process.\n`);
};

const knownOpenCodePaths = (): string[] => {
  const home = process.env.HOME;
  return [
    Bun.which("opencode") ?? "",
    home ? `${home}/.opencode/bin/opencode` : "",
    home ? `${home}/.local/bin/opencode` : "",
  ].filter(
    (value, index, values) =>
      value.length > 0 && values.indexOf(value) === index
  );
};

const readProcessOutput = async (
  stream: ReadableStream<Uint8Array> | null
): Promise<string> => (stream ? await new Response(stream).text() : "");

const getOpenCodeVersion = async (
  binaryPath: string
): Promise<string | null> => {
  const subprocess = Bun.spawn([binaryPath, "--version"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    subprocess.exited,
    readProcessOutput(subprocess.stderr),
    readProcessOutput(subprocess.stdout),
  ]);
  if (exitCode !== 0) {
    const details = stderr.trim();
    return details.length > 0 ? details : null;
  }

  const version = stdout.trim();
  return version.length > 0 ? version : null;
};

const detectOpenCode = async (): Promise<OpenCodeInstallResult | null> => {
  for (const candidatePath of knownOpenCodePaths()) {
    const file = Bun.file(candidatePath);
    if (!(await file.exists())) {
      continue;
    }

    const version = await getOpenCodeVersion(candidatePath);
    return {
      path: candidatePath,
      version: version ?? "unknown",
    };
  }

  return null;
};

const runOpenCodeInstall = async (): Promise<void> => {
  process.stdout.write("OpenCode was not found. Installing now...\n");
  process.stdout.write(
    `Install command: ${OPEN_CODE_INSTALL_COMMAND_NO_PATH}\n`
  );

  const subprocess = Bun.spawn(
    ["bash", "-lc", OPEN_CODE_INSTALL_COMMAND_NO_PATH],
    {
      stderr: "inherit",
      stdout: "inherit",
    }
  );
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(
      [
        "Failed to auto-install OpenCode.",
        `Run this manually and retry: ${OPEN_CODE_INSTALL_COMMAND}`,
      ].join("\n")
    );
  }
};

export const ensureOpenCodeInstalled = async (
  forceInstall: boolean
): Promise<OpenCodeInstallResult> => {
  const detectedBeforeInstall = await detectOpenCode();
  if (detectedBeforeInstall) {
    ensureBinaryDirectoryOnPath(detectedBeforeInstall.path);
    process.stdout.write(
      `OpenCode detected at ${detectedBeforeInstall.path} (${detectedBeforeInstall.version}).\n`
    );
    return detectedBeforeInstall;
  }

  const shouldAutoInstall =
    forceInstall || process.env.GITHUB_ACTIONS === "true";
  if (!shouldAutoInstall) {
    throw new Error(
      [
        "OpenCode CLI is required but was not found.",
        `Install it with: ${OPEN_CODE_INSTALL_COMMAND}`,
        "Then rerun this command, or pass --install-opencode to auto-install.",
      ].join("\n")
    );
  }

  await runOpenCodeInstall();
  const detectedAfterInstall = await detectOpenCode();
  if (!detectedAfterInstall) {
    throw new Error(
      [
        "OpenCode install completed but the binary was still not detected.",
        `Try opening a new shell or run manually: ${OPEN_CODE_INSTALL_COMMAND}`,
      ].join("\n")
    );
  }

  process.stdout.write(
    `OpenCode installed at ${detectedAfterInstall.path} (${detectedAfterInstall.version}).\n`
  );
  ensureBinaryDirectoryOnPath(detectedAfterInstall.path);
  return detectedAfterInstall;
};

export const runDoctor = async (): Promise<void> => {
  const detected = await detectOpenCode();
  process.stdout.write("Octavio doctor\n");
  process.stdout.write(`- bun: ${Bun.version}\n`);
  if (detected) {
    process.stdout.write(`- opencode: installed (${detected.version})\n`);
    process.stdout.write(`- opencode-path: ${detected.path}\n`);
  } else {
    process.stdout.write("- opencode: missing\n");
    process.stdout.write(`- install: ${OPEN_CODE_INSTALL_COMMAND}\n`);
  }
};
