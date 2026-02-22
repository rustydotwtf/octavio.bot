import { Database } from "bun:sqlite";

import type { ChatMessageRow, MessageRole } from "./types";

interface ConversationRow {
  createdAt: string;
  id: string;
  updatedAt: string;
}

const nowIso = (): string => new Date().toISOString();

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
    conversationId: string;
    id: string;
    role: MessageRole;
    text: string;
  }): void {
    const timestamp = nowIso();
    this.db
      .query(
        "INSERT INTO messages (id, conversation_id, role, content_json, created_at) VALUES ($id, $conversationId, $role, $contentJson, $createdAt)"
      )
      .run({
        contentJson: JSON.stringify({ text: input.text }),
        conversationId: input.conversationId,
        createdAt: timestamp,
        id: input.id,
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
        "SELECT id, conversation_id as conversationId, role, content_json as contentJson, created_at as createdAt FROM messages WHERE conversation_id = $conversationId ORDER BY created_at ASC"
      )
      .all({ conversationId });
  }

  public startToolCall(input: {
    conversationId: string;
    inputJson: string;
    toolName: string;
  }): string {
    const id = crypto.randomUUID();
    this.db
      .query(
        "INSERT INTO tool_calls (id, conversation_id, tool_name, input_json, status, created_at) VALUES ($id, $conversationId, $toolName, $inputJson, $status, $createdAt)"
      )
      .run({
        conversationId: input.conversationId,
        createdAt: nowIso(),
        id,
        inputJson: input.inputJson,
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
      "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content_json TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)"
    );
    this.db.run(
      "CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, tool_name TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation_created ON tool_calls(conversation_id, created_at)"
    );
  }
}
