// A store whose statements are recorded as they run, and the plan SQLite makes for one: tests check what a read does
// to a large store without needing one.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { createBus } from "../bus.ts";
import { createStore, type Store } from "../domain/store.ts";

type Ran = { sql: string; params: SQLInputValue[] };

/** The store, and the statements it ran (text and bound values) since the last `take()`. */
export function recordingStore(db: DatabaseSync): { store: Store; take: () => Ran[] } {
  let ran: Ran[] = [];
  const recording = new Proxy(db, {
    get(target, key) {
      if (key === "prepare")
        return (text: string) => {
          const st = target.prepare(text);
          return new Proxy(st, {
            get(s, method) {
              const value = Reflect.get(s, method, s);
              if (typeof value !== "function") return value;
              if (method === "all" || method === "get" || method === "run" || method === "iterate")
                return (...params: SQLInputValue[]) => {
                  ran.push({ sql: text, params });
                  return value.apply(s, params);
                };
              return value.bind(s);
            },
          });
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    store: createStore(recording, createBus()),
    take: () => {
      const out = ran;
      ran = [];
      return out;
    },
  };
}

/** What SQLite does for a recorded statement, one step per line. */
export function plan(db: DatabaseSync, q: Ran): string {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
    .all(...q.params)
    .map((row) => String(row.detail))
    .join("\n");
}
