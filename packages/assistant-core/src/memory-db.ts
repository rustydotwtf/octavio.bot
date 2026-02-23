import { Database } from "bun:sqlite";

import { joyful } from "joyful";

interface ChatMemoryRow {
  bodyMarkdown: string;
  createdAt: string;
  id: string;
  joyfulId: string;
  title: string;
}

interface ChatMemorySearchRow {
  bodyMarkdown: string;
  createdAt: string;
  joyfulId: string;
  matchRank: number;
  title: string;
}

interface ChatMemoryListRow {
  bodyMarkdown: string;
  createdAt: string;
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
const DEFAULT_SEARCH_SNIPPET_LENGTH = 140;

const nowIso = (): string => new Date().toISOString();

const escapeLikePattern = (value: string): string => {
  let escaped = "";

  for (const character of value) {
    if (character === "\\" || character === "%" || character === "_") {
      escaped += "\\";
    }
    escaped += character;
  }

  return escaped;
};

const normalizeSnippetText = (value: string): string =>
  value.trim().split(/\s+/).join(" ");

const toSnippet = (
  bodyMarkdown: string,
  query: string,
  maxLength = DEFAULT_SEARCH_SNIPPET_LENGTH
): string => {
  const normalizedBody = normalizeSnippetText(bodyMarkdown);
  if (normalizedBody.length === 0) {
    return "(empty memory body)";
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    const head = normalizedBody.slice(0, maxLength).trimEnd();
    return head.length < normalizedBody.length ? `${head}...` : head;
  }

  const lowerBody = normalizedBody.toLowerCase();
  const lowerQuery = trimmedQuery.toLowerCase();
  const queryIndex = lowerBody.indexOf(lowerQuery);

  if (queryIndex === -1) {
    const head = normalizedBody.slice(0, maxLength).trimEnd();
    return head.length < normalizedBody.length ? `${head}...` : head;
  }

  const minimumContext = 20;
  const aroundMatch = Math.max(
    minimumContext,
    Math.floor((maxLength - lowerQuery.length) / 2)
  );
  const start = Math.max(0, queryIndex - aroundMatch);
  const end = Math.min(
    normalizedBody.length,
    queryIndex + lowerQuery.length + aroundMatch
  );
  const sliced = normalizedBody.slice(start, end).trim();
  const clipped = sliced.slice(0, maxLength).trimEnd();

  const prefix = start > 0 ? "..." : "";
  const suffix = end < normalizedBody.length ? "..." : "";
  return `${prefix}${clipped}${suffix}`;
};

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

export interface ChatMemorySearchResult {
  createdAt: string;
  joyfulId: string;
  snippet: string;
  title: string;
}

export interface ChatMemoryListResult {
  createdAt: string;
  joyfulId: string;
  snippet: string;
  title: string;
}

export interface ChatMemoryListPage {
  hasNextPage: boolean;
  limit: number;
  memories: ChatMemoryListResult[];
  page: number;
  totalCount: number;
  totalPages: number;
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

  public searchMemories(query: string, limit = 5): ChatMemorySearchResult[] {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      throw new Error("Memory query must be non-empty.");
    }

    const boundedLimit = Math.max(1, Math.min(limit, 10));
    const exactTitle = trimmedQuery.toLowerCase();
    const pattern = `%${escapeLikePattern(exactTitle)}%`;

    return this.db
      .query<
        ChatMemorySearchRow,
        {
          exactTitle: string;
          limit: number;
          pattern: string;
        }
      >(
        "SELECT joyful_id as joyfulId, title, body_markdown as bodyMarkdown, created_at as createdAt, CASE WHEN lower(title) = $exactTitle THEN 0 WHEN lower(title) LIKE $pattern ESCAPE '\\' THEN 1 ELSE 2 END as matchRank FROM memory_entries WHERE lower(title) LIKE $pattern ESCAPE '\\' OR lower(body_markdown) LIKE $pattern ESCAPE '\\' ORDER BY matchRank ASC, created_at DESC, rowid DESC LIMIT $limit"
      )
      .all({
        exactTitle,
        limit: boundedLimit,
        pattern,
      })
      .map(({ bodyMarkdown, createdAt, joyfulId, title }) => ({
        createdAt,
        joyfulId,
        snippet: toSnippet(bodyMarkdown, trimmedQuery),
        title,
      }));
  }

  public listMemoriesPage(page = 1, limit = 10): ChatMemoryListPage {
    const boundedPage = Math.max(1, page);
    const boundedLimit = Math.max(1, Math.min(limit, 25));

    const totalCount =
      this.db
        .query<{ totalCount: number }, Record<string, never>>(
          "SELECT COUNT(*) as totalCount FROM memory_entries"
        )
        .get({})?.totalCount ?? 0;

    const totalPages =
      totalCount === 0 ? 0 : Math.ceil(totalCount / boundedLimit);
    const offset = (boundedPage - 1) * boundedLimit;

    const memories = this.db
      .query<
        ChatMemoryListRow,
        {
          limit: number;
          offset: number;
        }
      >(
        "SELECT joyful_id as joyfulId, title, body_markdown as bodyMarkdown, created_at as createdAt FROM memory_entries ORDER BY created_at DESC, rowid DESC LIMIT $limit OFFSET $offset"
      )
      .all({
        limit: boundedLimit,
        offset,
      })
      .map(({ bodyMarkdown, createdAt, joyfulId, title }) => ({
        createdAt,
        joyfulId,
        snippet: toSnippet(bodyMarkdown, ""),
        title,
      }));

    return {
      hasNextPage: boundedPage * boundedLimit < totalCount,
      limit: boundedLimit,
      memories,
      page: boundedPage,
      totalCount,
      totalPages,
    };
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
