interface CommandResult {
  code: number;
  stderr: string;
  stdout: string;
}

const SMOKE_PORT = Number.parseInt(process.env.IDCMD_SMOKE_PORT ?? "4173", 10);
const BASE_URL =
  process.env.IDCMD_SMOKE_BASE_URL ?? `http://127.0.0.1:${String(SMOKE_PORT)}`;
const CURL_MAX_TIME_SECONDS = "5";
const READY_TIMEOUT_MS = 60_000;
const READY_INTERVAL_MS = 500;
const SHUTDOWN_TIMEOUT_MS = 5000;

const delay = (ms: number): Promise<void> => Bun.sleep(ms);

const runCommand = async (command: string[]): Promise<CommandResult> => {
  const proc = Bun.spawn(command, {
    cwd: process.cwd(),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stderr, stdout };
};

const runCurl = (path: string): Promise<CommandResult> =>
  runCommand([
    "curl",
    "-fsS",
    "--max-time",
    CURL_MAX_TIME_SECONDS,
    `${BASE_URL}${path}`,
  ]);

const assertCommandOk = (label: string, result: CommandResult): void => {
  if (result.code === 0) {
    return;
  }
  throw new Error(
    [
      `${label} failed with exit code ${String(result.code)}.`,
      "stdout:",
      result.stdout.trim() || "(empty)",
      "stderr:",
      result.stderr.trim() || "(empty)",
    ].join("\n")
  );
};

const expectIncludes = (args: {
  haystack: string;
  label: string;
  needle: string;
}): void => {
  if (args.haystack.includes(args.needle)) {
    return;
  }
  throw new Error(`Expected ${args.label} to include ${args.needle}.`);
};

const waitForReady = async (): Promise<void> => {
  const startedAt = Date.now();
  let lastFailure = "(no attempts yet)";

  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    const ready = await runCurl("/");
    if (ready.code === 0) {
      return;
    }
    lastFailure = ready.stderr.trim() || ready.stdout.trim() || "curl failed";
    await delay(READY_INTERVAL_MS);
  }

  throw new Error(
    `dev server at ${BASE_URL} did not become ready within ${String(
      READY_TIMEOUT_MS
    )}ms. Last curl failure: ${lastFailure}`
  );
};

const shutdownDev = async (
  proc: ReturnType<typeof Bun.spawn>
): Promise<void> => {
  try {
    proc.kill("SIGTERM");
  } catch {
    return;
  }

  const didExit = await Promise.race([
    proc.exited.then(() => true),
    delay(SHUTDOWN_TIMEOUT_MS).then(() => false),
  ]);
  if (!didExit) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // ignore
    }
    await proc.exited;
  }
};

const assertHomeResponse = async (): Promise<void> => {
  const home = await runCurl("/");
  assertCommandOk("curl /", home);
  expectIncludes({ haystack: home.stdout, label: "/", needle: "<html" });
};

const assertProductsResponse = async (): Promise<void> => {
  const products = await runCurl("/");
  assertCommandOk("curl /", products);
  if (!products.stdout.includes("Review CLI")) {
    throw new Error("Expected / response to include the Review CLI section.");
  }
};

const assertLlmsResponse = async (): Promise<void> => {
  const llms = await runCurl("/llms.txt");
  assertCommandOk("curl /llms.txt", llms);
  if (llms.stdout.trim().length === 0 || !llms.stdout.includes("index.md")) {
    throw new Error("Expected /llms.txt to be non-empty and include index.md.");
  }
};

const assertApiResponse = async (): Promise<void> => {
  const api = await runCurl("/api/hello");
  assertCommandOk("curl /api/hello", api);
  const payload = JSON.parse(api.stdout) as { message?: string; ok?: boolean };
  if (payload.ok !== true || payload.message !== "Hello from idcmd route!") {
    throw new Error("Expected /api/hello payload to match template route.");
  }
};

const runSmokeChecks = async (): Promise<void> => {
  await assertHomeResponse();
  await assertProductsResponse();
  await assertLlmsResponse();
  await assertApiResponse();
};

const runProjectCheck = async (): Promise<void> => {
  const check = await runCommand([process.execPath, "run", "check"]);
  assertCommandOk("bun run check", check);
};

const startDev = (): {
  devProc: ReturnType<typeof Bun.spawn>;
  devStderr: Promise<string>;
  devStdout: Promise<string>;
} => {
  const devProc = Bun.spawn(
    [process.execPath, "run", "dev", "--", "--port", String(SMOKE_PORT)],
    {
      cwd: process.cwd(),
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  return {
    devProc,
    devStderr: new Response(devProc.stderr).text(),
    devStdout: new Response(devProc.stdout).text(),
  };
};

const logDevFailure = async (args: {
  error: unknown;
  stderr: Promise<string>;
  stdout: Promise<string>;
}): Promise<void> => {
  const [stdout, stderr] = await Promise.all([args.stdout, args.stderr]);
  const message =
    args.error instanceof Error ? args.error.message : String(args.error);
  console.error(message);
  console.error("dev stdout:");
  console.error(stdout.trim() || "(empty)");
  console.error("dev stderr:");
  console.error(stderr.trim() || "(empty)");
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const runDevSmokeFlow = async (): Promise<number> => {
  const { devProc, devStderr, devStdout } = startDev();

  try {
    await waitForReady();
    await runSmokeChecks();
  } catch (error) {
    await logDevFailure({ error, stderr: devStderr, stdout: devStdout });
    return 1;
  } finally {
    await shutdownDev(devProc);
  }
  return 0;
};

const runPostDevCheck = async (): Promise<number> => {
  try {
    await runProjectCheck();
    return 0;
  } catch (error) {
    console.error(toErrorMessage(error));
    return 1;
  }
};

const main = async (): Promise<number> => {
  const smokeCode = await runDevSmokeFlow();
  if (smokeCode !== 0) {
    return smokeCode;
  }
  return runPostDevCheck();
};

const code = await main();
process.exit(code);
