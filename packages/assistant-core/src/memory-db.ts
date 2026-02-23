import { Database } from "bun:sqlite";

import { joyful } from "joyful";

interface ChatMemoryRow {
  bodyMarkdown: string;
  createdAt: string;
  id: string;
  joyfulId: string;
  title: string;
}

interface MemoryStoreOptions {
  joyfulIdAttempts?: number;
  joyfulIdSegments?: number;
}

const DEFAULT_JOYFUL_ID_ATTEMPTS = 10;
const DEFAULT_JOYFUL_ID_SEGMENTS = 4;
const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5000;

const nowIso = (): string => new Date().toISOString();

const getDirectoryPath = (filePath: string): string => {
  const separatorIndex = Math.max(
    filePath.lastIndexOf("/"),
    filePath.lastIndexOf("\\")
  );
  if (separatorIndex <= 0) {
    return ".";
  }

  return filePath.slice(0, separatorIndex);
};

const ensureDatabaseDirectory = (dbPath: string): void => {
  if (dbPath === ":memory:") {
    return;
  }

  const directoryPath = getDirectoryPath(dbPath);
  if (directoryPath === ".") {
    return;
  }

  const result = Bun.spawnSync(["mkdir", "-p", directoryPath], {
    stderr: "pipe",
    stdout: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim();
    throw new Error(
      `Failed to create SQLite directory "${directoryPath}": ${stderr || "unknown error"}`
    );
  }
};

const isSqliteUniqueConstraintError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const errorCode = (error as { code?: unknown }).code;
  const errorErrno = (error as { errno?: unknown }).errno;
  const errorMessage =
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";

  return (
    errorCode === "SQLITE_CONSTRAINT_UNIQUE" ||
    errorErrno === 2067 ||
    errorMessage.includes("UNIQUE constraint failed")
  );
};

const isJoyfulIdUniqueConstraintError = (error: unknown): boolean => {
  if (!isSqliteUniqueConstraintError(error)) {
    return false;
  }

  const errorMessage =
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";

  return errorMessage.includes("memory_entries.joyful_id");
};

const parseJoyfulIdAttempts = (value: number | undefined): number => {
  if (!value || !Number.isInteger(value) || value < 1) {
    return DEFAULT_JOYFUL_ID_ATTEMPTS;
  }

  return value;
};

const parseJoyfulIdSegments = (value: number | undefined): number => {
  if (!value || !Number.isInteger(value) || value < 2) {
    return DEFAULT_JOYFUL_ID_SEGMENTS;
  }

  return value;
};

export interface ChatMemory {
  bodyMarkdown: string;
  createdAt: string;
  joyfulId: string;
  title: string;
}

export class MemoryStore {
  private readonly db: Database;
  private readonly joyfulIdAttempts: number;
  private readonly joyfulIdSegments: number;

  public constructor(dbPath: string, options: MemoryStoreOptions = {}) {
    ensureDatabaseDirectory(dbPath);
    this.db = new Database(dbPath, { create: true, strict: true });
    this.joyfulIdAttempts = parseJoyfulIdAttempts(options.joyfulIdAttempts);
    this.joyfulIdSegments = parseJoyfulIdSegments(options.joyfulIdSegments);
    this.db.run(`PRAGMA busy_timeout = ${DEFAULT_SQLITE_BUSY_TIMEOUT_MS};`);
    this.db.run("PRAGMA foreign_keys = ON;");
    this.setup();
  }

  public listMemoriesByTitle(title: string, limit = 10): ChatMemory[] {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      throw new Error("Memory title must be non-empty.");
    }

    const boundedLimit = Math.max(1, Math.min(limit, 100));

    return this.db
      .query<ChatMemoryRow, { limit: number; title: string }>(
        "SELECT id, joyful_id as joyfulId, title, body_markdown as bodyMarkdown, created_at as createdAt FROM memory_entries WHERE title = $title ORDER BY created_at DESC, rowid DESC LIMIT $limit"
      )
      .all({
        limit: boundedLimit,
        title: trimmedTitle,
      })
      .map(({ bodyMarkdown, createdAt, joyfulId, title: entryTitle }) => ({
        bodyMarkdown,
        createdAt,
        joyfulId,
        title: entryTitle,
      }));
  }

  public saveMemory(input: {
    bodyMarkdown: string;
    title: string;
  }): ChatMemory {
    const trimmedTitle = input.title.trim();
    if (trimmedTitle.length === 0) {
      throw new Error("Memory title must be non-empty.");
    }

    if (input.bodyMarkdown.length === 0) {
      throw new Error("Memory body markdown must be non-empty.");
    }

    const createdAt = nowIso();

    for (let attempt = 1; attempt <= this.joyfulIdAttempts; attempt += 1) {
      const row: ChatMemoryRow = {
        bodyMarkdown: input.bodyMarkdown,
        createdAt,
        id: crypto.randomUUID(),
        joyfulId: joyful({
          segments: this.joyfulIdSegments,
          separator: "-",
        }),
        title: trimmedTitle,
      };

      try {
        this.db
          .query<
            never,
            {
              bodyMarkdown: string;
              createdAt: string;
              id: string;
              joyfulId: string;
              title: string;
            }
          >(
            "INSERT INTO memory_entries (id, joyful_id, title, body_markdown, created_at) VALUES ($id, $joyfulId, $title, $bodyMarkdown, $createdAt)"
          )
          .run({
            bodyMarkdown: row.bodyMarkdown,
            createdAt: row.createdAt,
            id: row.id,
            joyfulId: row.joyfulId,
            title: row.title,
          });

        return {
          bodyMarkdown: row.bodyMarkdown,
          createdAt: row.createdAt,
          joyfulId: row.joyfulId,
          title: row.title,
        };
      } catch (error: unknown) {
        if (isJoyfulIdUniqueConstraintError(error)) {
          continue;
        }

        throw error;
      }
    }

    throw new Error(
      `Unable to generate a unique joyful memory id after ${this.joyfulIdAttempts} attempt(s).`
    );
  }

  private setup(): void {
    this.db.run(
      "CREATE TABLE IF NOT EXISTS memory_entries (id TEXT PRIMARY KEY, joyful_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, body_markdown TEXT NOT NULL, created_at TEXT NOT NULL)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_memory_entries_title_created ON memory_entries(title, created_at)"
    );
  }
}
