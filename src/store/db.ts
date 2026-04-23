import path from "path";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import type { RawItem, SourceItem, ProfileSnapshot } from "../schema";

let _db: ReturnType<typeof openDb> | null = null;

function openDb() {
  // Dynamic import of better-sqlite3 to avoid bundling issues
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");

  const dir = path.join(os.homedir(), ".local", "share", "pathrix-scout");
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, "scout.db");

  const db = new Database(dbPath);

  // WAL mode for concurrent reads
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      intent TEXT,
      source_count INTEGER DEFAULT 0,
      item_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      url TEXT NOT NULL,
      author TEXT,
      engagement_json TEXT,
      scout_score REAL DEFAULT 0,
      rrf_score REAL DEFAULT 0,
      run_id TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (run_id) REFERENCES runs(run_id)
    );

    CREATE TABLE IF NOT EXISTS profile_snapshots (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      followers INTEGER DEFAULT 0,
      posts_json TEXT,
      stats_json TEXT,
      UNIQUE(platform, handle, fetched_at)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title, body,
      content='items',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
    END;
    CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
      INSERT INTO items_fts(items_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
      INSERT INTO items_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
    END;
  `);

  return db;
}

function getDb() {
  if (!_db) _db = openDb();
  return _db;
}

export function urlToId(url: string): string {
  const normalized = url.trim().toLowerCase().replace(/\/$/, "");
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 32);
}

export function saveRun(runId: string, query: string, intent?: string) {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO runs (run_id, query, intent) VALUES (?, ?, ?)`
  ).run(runId, query, intent ?? null);
}

export function saveItems(items: SourceItem[], runId: string) {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO items (id, source, title, body, url, author, engagement_json, scout_score, rrf_score, run_id, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      engagement_json = excluded.engagement_json,
      scout_score = excluded.scout_score,
      rrf_score = excluded.rrf_score,
      run_id = excluded.run_id
  `);

  const insertMany = db.transaction((rows: SourceItem[]) => {
    for (const item of rows) {
      upsert.run(
        item.id,
        item.source,
        item.title,
        item.body,
        item.url,
        item.author,
        JSON.stringify(item.engagement),
        item.scoutScore,
        item.rrfScore,
        runId,
        item.publishedAt
      );
    }
  });
  insertMany(items);
}

export function saveProfileSnapshot(snapshot: ProfileSnapshot) {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT OR REPLACE INTO profile_snapshots (id, platform, handle, fetched_at, followers, posts_json, stats_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    snapshot.platform,
    snapshot.handle,
    snapshot.fetchedAt,
    snapshot.followers,
    JSON.stringify(snapshot.posts),
    JSON.stringify(snapshot.stats)
  );
}

export function searchItems(q: string, limit = 20): RawItem[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT i.* FROM items_fts
    JOIN items i ON items_fts.rowid = i.rowid
    WHERE items_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(q + "*", limit) as any[];

  return rows.map(rowToItem);
}

export function getRecentItems(limit = 50): RawItem[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM items ORDER BY created_at DESC LIMIT ?`
  ).all(limit) as any[];
  return rows.map(rowToItem);
}

export function getLatestProfileSnapshot(platform: string): ProfileSnapshot | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM profile_snapshots WHERE platform = ?
    ORDER BY fetched_at DESC LIMIT 1
  `).get(platform) as any;
  if (!row) return null;
  return {
    platform: row.platform,
    handle: row.handle,
    fetchedAt: row.fetched_at,
    followers: row.followers,
    posts: JSON.parse(row.posts_json ?? "[]"),
    stats: JSON.parse(row.stats_json ?? "{}"),
  };
}

function rowToItem(row: any): RawItem {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    body: row.body ?? "",
    url: row.url,
    author: row.author ?? "",
    engagement: JSON.parse(row.engagement_json ?? "{}"),
    scoutScore: row.scout_score,
    publishedAt: row.published_at ?? "",
  };
}
