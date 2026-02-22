import { $ } from "bun";

const MARKDOWN_EXTENSION = ".md";
const POLL_INTERVAL_MS = 400;

const appRootUrl = new URL("../", import.meta.url);
const promptsDirUrl = new URL(
  "../../../packages/prompts/prompts/",
  import.meta.url
);
const appRootPath = Bun.fileURLToPath(appRootUrl);
const promptsDirPath = Bun.fileURLToPath(promptsDirUrl);

let isSyncRunning = false;
let isSyncQueued = false;
let latestSnapshot = "";

const createPromptSnapshot = async (): Promise<string> => {
  const glob = new Bun.Glob(`*${MARKDOWN_EXTENSION}`);
  const state: string[] = [];

  for await (const fileName of glob.scan({
    cwd: promptsDirPath,
    onlyFiles: true,
  })) {
    const fileUrl = new URL(fileName, promptsDirUrl);
    const file = Bun.file(fileUrl);
    state.push(`${fileName}:${file.lastModified}:${file.size}`);
  }

  return state.toSorted((a, b) => a.localeCompare(b)).join("|");
};

const executeSync = async (reason: string): Promise<void> => {
  console.log(`[watch-prompts] syncing (${reason})`);
  await $`bun run sync`.cwd(appRootPath);
  console.log("[watch-prompts] sync complete");
};

const queueSync = (): void => {
  isSyncQueued = true;
};

const syncWithLogging = async (reason: string): Promise<void> => {
  try {
    await executeSync(reason);
  } catch (error) {
    console.error("[watch-prompts] sync failed");
    console.error(error);
  }
};

const consumeQueuedReason = (): string | undefined => {
  if (!isSyncQueued) {
    return undefined;
  }

  isSyncQueued = false;
  return "queued change";
};

const runSync = async (reason: string): Promise<void> => {
  if (isSyncRunning) {
    queueSync();
    return;
  }

  let nextReason: string | undefined = reason;

  while (nextReason) {
    isSyncRunning = true;
    await syncWithLogging(nextReason);
    isSyncRunning = false;
    nextReason = consumeQueuedReason();
  }
};

const pollForChanges = async (): Promise<void> => {
  const nextSnapshot = await createPromptSnapshot();
  if (nextSnapshot === latestSnapshot) {
    return;
  }

  latestSnapshot = nextSnapshot;
  await runSync("prompt markdown changed");
};

await runSync("startup");
latestSnapshot = await createPromptSnapshot();

console.log(`[watch-prompts] polling ${promptsDirPath} for changes`);

for (;;) {
  await Bun.sleep(POLL_INTERVAL_MS);

  try {
    await pollForChanges();
  } catch (error) {
    console.error("[watch-prompts] polling failed");
    console.error(error);
  }
}
