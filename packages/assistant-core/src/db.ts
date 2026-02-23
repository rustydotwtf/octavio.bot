import { Database } from "bun:sqlite";

import type { ChatMessageRow, MessageRole } from "./types";

interface ConversationRow {
  createdAt: string;
  id: string;
  updatedAt: string;
}

interface AppStateRow {
  key: string;
  value: string;
}

interface TableInfoRow {
  name: string;
}

interface TotalBytesRow {
  totalBytes: number;
}

interface ChatStoreOptions {
  debugLogMb?: number;
}

interface DebugEventRow {
  channel: string;
  conversationId: string | null;
  createdAt: string;
  eventType: string;
  id: string;
  model: string | null;
  payloadBytes: number;
  payloadJson: string;
  requestId: string | null;
  source: string;
  stepId: string | null;
}

const nowIso = (): string => new Date().toISOString();
const ACTIVE_CONVERSATION_ID_KEY = "active_conversation_id";
const DEFAULT_DEBUG_LOG_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5000;
const textEncoder = new TextEncoder();

const isSqliteBusyError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const errorCode = (error as { code?: unknown }).code;
  const errorErrno = (error as { errno?: unknown }).errno;
  return errorCode === "SQLITE_BUSY" || errorErrno === 5;
};

const parseDebugLogMaxBytes = (value: number | undefined): number => {
  if (value === undefined) {
    return DEFAULT_DEBUG_LOG_MAX_BYTES;
  }

  if (!Number.isInteger(value) || value < 0) {
    return DEFAULT_DEBUG_LOG_MAX_BYTES;
  }

  return value * 1024 * 1024;
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

export class ChatStore {
  private readonly db: Database;
  private readonly debugLogMaxBytes: number;

  public constructor(dbPath: string, options: ChatStoreOptions = {}) {
    ensureDatabaseDirectory(dbPath);
    this.db = new Database(dbPath, { create: true, strict: true });
    this.debugLogMaxBytes = parseDebugLogMaxBytes(options.debugLogMb);
    this.db.run(`PRAGMA busy_timeout = ${DEFAULT_SQLITE_BUSY_TIMEOUT_MS};`);
    try {
      this.db.run("PRAGMA journal_mode = WAL;");
    } catch (error: unknown) {
      if (!isSqliteBusyError(error)) {
        throw error;
      }
    }
    this.db.run("PRAGMA foreign_keys = ON;");
    this.setup();
  }

  public createConversation(id: string): string {
    const timestamp = nowIso();
    this.db
      .query(
        "INSERT INTO conversations (id, created_at, updated_at) VALUES ($id, $createdAt, $updatedAt)"
      )
      .run({
        createdAt: timestamp,
        id,
        updatedAt: timestamp,
      });

    return id;
  }

  public getActiveConversationId(): string | undefined {
    return this.getAppStateValue(ACTIVE_CONVERSATION_ID_KEY);
  }

  public getAppStateValue(key: string): string | undefined {
    const row = this.db
      .query<AppStateRow, { key: string }>(
        "SELECT key, value FROM app_state WHERE key = $key LIMIT 1"
      )
      .get({ key });

    return row?.value;
  }

  public setActiveConversationId(id: string): string {
    this.setAppStateValue(ACTIVE_CONVERSATION_ID_KEY, id);
    return id;
  }

  public setAppStateValue(key: string, value: string): string {
    this.db
      .query(
        "INSERT INTO app_state (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run({
        key,
        value,
      });

    return value;
  }

  public startNewConversation(): string {
    const id = crypto.randomUUID();
    this.createConversation(id);
    this.setActiveConversationId(id);
    return id;
  }

  public resolveActiveConversationId(): string {
    const existingActiveConversationId = this.getActiveConversationId();

    if (
      existingActiveConversationId &&
      existingActiveConversationId.length > 0
    ) {
      this.ensureConversation(existingActiveConversationId);
      return existingActiveConversationId;
    }

    return this.startNewConversation();
  }

  public ensureConversation(id: string): string {
    const existing = this.db
      .query<ConversationRow, { id: string }>(
        "SELECT id, created_at as createdAt, updated_at as updatedAt FROM conversations WHERE id = $id LIMIT 1"
      )
      .get({ id });

    if (!existing) {
      return this.createConversation(id);
    }

    return existing.id;
  }

  public saveMessage(input: {
    channel?: string;
    conversationId: string;
    id: string;
    metadataJson?: string;
    role: MessageRole;
    text: string;
  }): void {
    const timestamp = nowIso();
    this.db
      .query(
        "INSERT INTO messages (id, conversation_id, role, content_json, channel, metadata_json, created_at) VALUES ($id, $conversationId, $role, $contentJson, $channel, $metadataJson, $createdAt)"
      )
      .run({
        channel: input.channel ?? "api",
        contentJson: JSON.stringify({ text: input.text }),
        conversationId: input.conversationId,
        createdAt: timestamp,
        id: input.id,
        metadataJson: input.metadataJson ?? null,
        role: input.role,
      });

    this.db
      .query("UPDATE conversations SET updated_at = $updatedAt WHERE id = $id")
      .run({
        id: input.conversationId,
        updatedAt: timestamp,
      });
  }

  public listMessages(conversationId: string): ChatMessageRow[] {
    return this.db
      .query<ChatMessageRow, { conversationId: string }>(
        "SELECT id, conversation_id as conversationId, role, content_json as contentJson, channel, metadata_json as metadataJson, created_at as createdAt FROM messages WHERE conversation_id = $conversationId ORDER BY created_at ASC"
      )
      .all({ conversationId });
  }

  public startToolCall(input: {
    channel?: string;
    conversationId: string;
    inputJson: string;
    metadataJson?: string;
    toolName: string;
  }): string {
    const id = crypto.randomUUID();
    this.db
      .query(
        "INSERT INTO tool_calls (id, conversation_id, tool_name, input_json, metadata_json, channel, status, created_at) VALUES ($id, $conversationId, $toolName, $inputJson, $metadataJson, $channel, $status, $createdAt)"
      )
      .run({
        channel: input.channel ?? "api",
        conversationId: input.conversationId,
        createdAt: nowIso(),
        id,
        inputJson: input.inputJson,
        metadataJson: input.metadataJson ?? null,
        status: "started",
        toolName: input.toolName,
      });

    return id;
  }

  public finishToolCall(input: {
    id: string;
    outputJson: string;
    status: "completed" | "failed";
  }): void {
    this.db
      .query(
        "UPDATE tool_calls SET output_json = $outputJson, status = $status WHERE id = $id"
      )
      .run({
        id: input.id,
        outputJson: input.outputJson,
        status: input.status,
      });
  }

  public appendDebugEvent(input: {
    channel?: string;
    conversationId?: string;
    eventType: string;
    model?: string;
    payload: unknown;
    requestId?: string;
    source: string;
    stepId?: string;
  }): void {
    if (this.debugLogMaxBytes <= 0) {
      return;
    }

    const payloadJson = ChatStore.toJson(input.payload);
    const payloadBytes = textEncoder.encode(payloadJson).length;

    this.db
      .query(
        "INSERT INTO debug_events (id, conversation_id, channel, source, event_type, request_id, step_id, model, payload_json, payload_bytes, created_at) VALUES ($id, $conversationId, $channel, $source, $eventType, $requestId, $stepId, $model, $payloadJson, $payloadBytes, $createdAt)"
      )
      .run({
        channel: input.channel ?? "api",
        conversationId: input.conversationId ?? null,
        createdAt: nowIso(),
        eventType: input.eventType,
        id: crypto.randomUUID(),
        model: input.model ?? null,
        payloadBytes,
        payloadJson,
        requestId: input.requestId ?? null,
        source: input.source,
        stepId: input.stepId ?? null,
      });

    this.pruneDebugEventsToLimit();
  }

  public getDebugEventsTotalBytes(): number {
    const row = this.db
      .query<TotalBytesRow, Record<string, never>>(
        "SELECT COALESCE(SUM(payload_bytes), 0) as totalBytes FROM debug_events"
      )
      .get({});

    return row?.totalBytes ?? 0;
  }

  public listDebugEvents(limit = 100): DebugEventRow[] {
    const boundedLimit = Math.max(1, Math.min(limit, 1000));

    return this.db
      .query<DebugEventRow, { limit: number }>(
        "SELECT id, conversation_id as conversationId, channel, source, event_type as eventType, request_id as requestId, step_id as stepId, model, payload_json as payloadJson, payload_bytes as payloadBytes, created_at as createdAt FROM debug_events ORDER BY created_at DESC LIMIT $limit"
      )
      .all({ limit: boundedLimit });
  }

  private setup(): void {
    this.db.run(
      "CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    );
    this.db.run(
      "CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    );
    this.db.run(
      "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'api', metadata_json TEXT, created_at TEXT NOT NULL, FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)"
    );
    this.db.run(
      "CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, tool_name TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT, metadata_json TEXT, channel TEXT NOT NULL DEFAULT 'api', status TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation_created ON tool_calls(conversation_id, created_at)"
    );
    this.db.run(
      "CREATE TABLE IF NOT EXISTS debug_events (id TEXT PRIMARY KEY, conversation_id TEXT, channel TEXT NOT NULL DEFAULT 'api', source TEXT NOT NULL, event_type TEXT NOT NULL, request_id TEXT, step_id TEXT, model TEXT, payload_json TEXT NOT NULL, payload_bytes INTEGER NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_debug_events_created ON debug_events(created_at)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_debug_events_conversation_created ON debug_events(conversation_id, created_at)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_debug_events_request_created ON debug_events(request_id, created_at)"
    );

    this.ensureColumnExists(
      "messages",
      "channel",
      "ALTER TABLE messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'api'"
    );
    this.ensureColumnExists(
      "messages",
      "metadata_json",
      "ALTER TABLE messages ADD COLUMN metadata_json TEXT"
    );
    this.ensureColumnExists(
      "tool_calls",
      "metadata_json",
      "ALTER TABLE tool_calls ADD COLUMN metadata_json TEXT"
    );
    this.ensureColumnExists(
      "tool_calls",
      "channel",
      "ALTER TABLE tool_calls ADD COLUMN channel TEXT NOT NULL DEFAULT 'api'"
    );
    this.ensureColumnExists(
      "debug_events",
      "channel",
      "ALTER TABLE debug_events ADD COLUMN channel TEXT NOT NULL DEFAULT 'api'"
    );
    this.ensureColumnExists(
      "debug_events",
      "source",
      "ALTER TABLE debug_events ADD COLUMN source TEXT NOT NULL DEFAULT 'runtime'"
    );
    this.ensureColumnExists(
      "debug_events",
      "event_type",
      "ALTER TABLE debug_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'unknown'"
    );
    this.ensureColumnExists(
      "debug_events",
      "request_id",
      "ALTER TABLE debug_events ADD COLUMN request_id TEXT"
    );
    this.ensureColumnExists(
      "debug_events",
      "step_id",
      "ALTER TABLE debug_events ADD COLUMN step_id TEXT"
    );
    this.ensureColumnExists(
      "debug_events",
      "model",
      "ALTER TABLE debug_events ADD COLUMN model TEXT"
    );
    this.ensureColumnExists(
      "debug_events",
      "payload_json",
      "ALTER TABLE debug_events ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}'"
    );
    this.ensureColumnExists(
      "debug_events",
      "payload_bytes",
      "ALTER TABLE debug_events ADD COLUMN payload_bytes INTEGER NOT NULL DEFAULT 2"
    );
    this.ensureColumnExists(
      "debug_events",
      "created_at",
      "ALTER TABLE debug_events ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'"
    );
  }

  private pruneDebugEventsToLimit(): void {
    let totalBytes = this.getDebugEventsTotalBytes();

    while (totalBytes > this.debugLogMaxBytes) {
      const oldest = this.db
        .query<{ id: string; payloadBytes: number }, Record<string, never>>(
          "SELECT id, payload_bytes as payloadBytes FROM debug_events ORDER BY created_at ASC, id ASC LIMIT 1"
        )
        .get({});

      if (!oldest) {
        return;
      }

      this.db
        .query("DELETE FROM debug_events WHERE id = $id")
        .run({ id: oldest.id });
      totalBytes -= oldest.payloadBytes;
    }
  }

  private static toJson(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return JSON.stringify({ error: "Unable to serialize value" });
    }
  }

  private ensureColumnExists(
    tableName: string,
    columnName: string,
    alterStatement: string
  ): void {
    const columns = this.db
      .query<TableInfoRow, Record<string, never>>(
        `PRAGMA table_info(${tableName})`
      )
      .all({});
    const hasColumn = columns.some((column) => column.name === columnName);
    if (hasColumn) {
      return;
    }

    this.db.run(alterStatement);
  }
}
