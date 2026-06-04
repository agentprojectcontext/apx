// Vector store for the cross-channel memory RAG (Pieza 2).
//
// Dual backend, chosen at open() time:
//   1. SqliteVecStore — better-sqlite3 + the sqlite-vec extension, persisted to
//      ~/.apx/memory.db. Uses vec_distance_cosine() for scoring. Preferred.
//   2. JsonStore — a dependency-free JSONL file with brute-force cosine in JS.
//      Used when better-sqlite3 / sqlite-vec can't load (no native binary).
//
// Both expose the same interface:
//   upsert(rows)              rows: {id, source, channel, ts, tag, text, embedder, dim, vector}
//   search(vector, {embedder, k, channel}) -> [{...row, score}]
//   hasId(id) / count()
//   close()
//
// Cosine is only meaningful within one embedder space, so search() filters to
// rows whose `embedder` matches the query's embedder. Everything here is
// best-effort: open() never throws — on any failure it returns a JsonStore.

import fs from "node:fs";
import path from "node:path";
import { cosineSim } from "./embeddings.js";

function vecToBlob(vec) {
  const f = new Float32Array(vec);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

// ---------------------------------------------------------------------------
// JSON fallback store
// ---------------------------------------------------------------------------
export class JsonStore {
  constructor(jsonPath) {
    this.jsonPath = jsonPath;
    this.rows = new Map(); // id -> row {id, source, channel, ts, tag, text, embedder, dim, vector}
    this.backend = "json";
    this._load();
  }

  _load() {
    try {
      const text = fs.readFileSync(this.jsonPath, "utf8");
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const row = JSON.parse(t);
          if (row && row.id) this.rows.set(row.id, row);
        } catch {
          /* skip bad line */
        }
      }
    } catch {
      /* no file yet */
    }
  }

  _flush() {
    fs.mkdirSync(path.dirname(this.jsonPath), { recursive: true });
    const lines = [];
    for (const row of this.rows.values()) lines.push(JSON.stringify(row));
    const tmp = `${this.jsonPath}.tmp`;
    fs.writeFileSync(tmp, lines.join("\n") + (lines.length ? "\n" : ""));
    fs.renameSync(tmp, this.jsonPath);
  }

  upsert(rows) {
    let n = 0;
    for (const r of rows) {
      if (!r || !r.id) continue;
      this.rows.set(r.id, r);
      n++;
    }
    if (n) this._flush();
    return n;
  }

  hasId(id) {
    return this.rows.has(id);
  }

  count() {
    return this.rows.size;
  }

  clear() {
    this.rows.clear();
    this._flush();
  }

  search(vector, { embedder, k = 5, channel } = {}) {
    const scored = [];
    for (const row of this.rows.values()) {
      if (embedder && row.embedder !== embedder) continue;
      if (channel && row.channel !== channel) continue;
      if (!Array.isArray(row.vector) || row.vector.length !== vector.length) continue;
      scored.push({ ...row, score: cosineSim(vector, row.vector) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  close() {
    /* nothing to release */
  }
}

// ---------------------------------------------------------------------------
// sqlite-vec store
// ---------------------------------------------------------------------------
class SqliteVecStore {
  constructor(db) {
    this.db = db;
    this.backend = "sqlite-vec";
    db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        source TEXT,
        channel TEXT,
        ts TEXT,
        tag TEXT,
        text TEXT,
        embedder TEXT,
        dim INTEGER,
        vec BLOB
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_embedder ON chunks(embedder);
    `);
    this._insert = db.prepare(
      `INSERT INTO chunks (id, source, channel, ts, tag, text, embedder, dim, vec)
       VALUES (@id, @source, @channel, @ts, @tag, @text, @embedder, @dim, @vec)
       ON CONFLICT(id) DO UPDATE SET
         source=@source, channel=@channel, ts=@ts, tag=@tag, text=@text,
         embedder=@embedder, dim=@dim, vec=@vec`
    );
    this._has = db.prepare("SELECT 1 FROM chunks WHERE id = ?");
    this._count = db.prepare("SELECT COUNT(*) AS n FROM chunks");
  }

  upsert(rows) {
    const tx = this.db.transaction((items) => {
      let n = 0;
      for (const r of items) {
        if (!r || !r.id) continue;
        this._insert.run({
          id: r.id,
          source: r.source || null,
          channel: r.channel || null,
          ts: r.ts || null,
          tag: r.tag || null,
          text: r.text || "",
          embedder: r.embedder || null,
          dim: r.dim || (r.vector ? r.vector.length : 0),
          vec: vecToBlob(r.vector),
        });
        n++;
      }
      return n;
    });
    return tx(rows);
  }

  hasId(id) {
    return !!this._has.get(id);
  }

  count() {
    return this._count.get().n;
  }

  clear() {
    this.db.prepare("DELETE FROM chunks").run();
  }

  search(vector, { embedder, k = 5, channel } = {}) {
    const blob = vecToBlob(vector);
    const where = ["embedder = ?", "dim = ?"];
    const params = [embedder, vector.length];
    if (channel) {
      where.push("channel = ?");
      params.push(channel);
    }
    const rows = this.db
      .prepare(
        `SELECT id, source, channel, ts, tag, text, embedder, dim,
                vec_distance_cosine(vec, ?) AS dist
         FROM chunks
         WHERE ${where.join(" AND ")}
         ORDER BY dist ASC
         LIMIT ?`
      )
      .all(blob, ...params, k);
    // cosine distance → similarity score in [0,1] (sqlite-vec returns 1 - cos).
    return rows.map((r) => ({ ...r, score: 1 - r.dist }));
  }

  close() {
    try {
      this.db.close();
    } catch {
      /* ignore */
    }
  }
}

// Open the vector store. Async because the native modules are dynamically
// imported. Tries the sqlite-vec backend first; on ANY failure (module missing,
// extension load error, broken build) it returns a JsonStore. Never throws.
export async function openMemoryStore({ dbPath, jsonPath, log } = {}) {
  const note = typeof log === "function" ? log : () => {};
  if (!process.env.APX_MEMORY_FORCE_JSON) {
    try {
      const [{ default: Database }, sqliteVec] = await Promise.all([
        import("better-sqlite3"),
        import("sqlite-vec"),
      ]);
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      sqliteVec.load(db);
      // Smoke-test the extension so a broken build falls back cleanly.
      db.prepare("SELECT vec_distance_cosine(?, ?) AS d").get(
        vecToBlob([1, 0]),
        vecToBlob([1, 0])
      );
      note("memory: sqlite-vec backend active (" + dbPath + ")");
      return new SqliteVecStore(db);
    } catch (e) {
      note("memory: sqlite-vec unavailable (" + (e?.message || e) + ") — JSON fallback");
    }
  }
  return new JsonStore(jsonPath);
}
