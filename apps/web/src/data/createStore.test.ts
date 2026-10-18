import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStore, useSlice } from "./createStore.ts";

test("store merges patches without mutating snapshots and functional updates read current state", () => {
  const original = { count: 0, name: "Acme" };
  const store = createStore(original);
  const snapshots: unknown[] = [];
  const off = store.subscribe(() => snapshots.push(store.get()));
  store.set({ count: 1 });
  const first = store.get();
  store.set((state) => ({ count: state.count + 2 }));
  assert.deepEqual(original, { count: 0, name: "Acme" });
  assert.deepEqual(first, { count: 1, name: "Acme" });
  assert.deepEqual(store.get(), { count: 3, name: "Acme" });
  assert.deepEqual(snapshots, [
    { count: 1, name: "Acme" },
    { count: 3, name: "Acme" },
  ]);
  off();
  off();
  store.set({ name: "Northwind" });
  assert.equal(snapshots.length, 2);
  assert.deepEqual(store.get(), { count: 3, name: "Northwind" });
});

test("multiple subscribers receive the same committed state and unsubscribing one keeps the others", () => {
  const store = createStore({ count: 0 });
  const first: number[] = [],
    second: number[] = [];
  const off = store.subscribe(() => first.push(store.get().count));
  store.subscribe(() => second.push(store.get().count));
  store.set({ count: 1 });
  off();
  store.set({ count: 2 });
  assert.deepEqual(first, [1]);
  assert.deepEqual(second, [1, 2]);
});

test("React selectors can read server snapshots without a browser", () => {
  const store = createStore({ name: "Acme", count: 1 });
  const View = () =>
    createElement(
      "span",
      {},
      useSlice(store, (state) => state.name),
    );
  assert.equal(renderToStaticMarkup(createElement(View)), "<span>Acme</span>");
  store.set({ name: "Northwind" });
  assert.equal(renderToStaticMarkup(createElement(View)), "<span>Northwind</span>");
});
