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

const nowIso = (): string => new Date().toISOString();
const ACTIVE_CONVERSATION_ID_KEY = "active_conversation_id";

export class ChatStore {
  private readonly db: Database;

  public constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true, strict: true });
    this.db.run("PRAGMA journal_mode = WAL;");
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
