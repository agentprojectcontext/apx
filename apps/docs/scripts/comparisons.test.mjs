import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apxRowSources,
  apxRows,
  checked,
  comparisons,
  labels,
  sourceSnapshots,
  topics,
} from "../src/data/comparisons.ts";

test("each comparison supplies bilingual evidence-backed rows for every topic", () => {
  assert.equal(new Set(comparisons.map((item) => item.slug)).size, comparisons.length);
  for (const item of comparisons) {
    assert.match(item.slug, /^[a-z-]+$/);
    assert.equal(new URL(item.source).protocol, "https:");
    assert.equal(new URL(item.license).protocol, "https:");
    assert.equal(item.rows.length, topics.length);
    assert.equal(apxRows.length, topics.length);
    assert.equal(apxRowSources.length, topics.length);
    assert.equal(item.rowSources.length, topics.length);
    assert.equal(new URL(item.detailSource).protocol, "https:");
    for (const sources of [...apxRowSources, ...item.rowSources]) {
      assert.ok(sources.length > 0, "every assertion needs a source");
      for (const source of sources) assert.equal(new URL(source).protocol, "https:");
      assert.ok(
        sources.some((source) => new URL(source).pathname !== "/"),
        "link to a specific document",
      );
    }
    for (const copy of [
      item.tagline,
      item.intro,
      item.choice,
      item.detail,
      item.tryIt,
      ...item.rows,
      ...apxRows,
      ...topics,
    ]) {
      for (const lang of ["en", "es"]) assert.ok(copy[lang].trim().length > 5, `${item.slug}: missing ${lang} copy`);
      assert.notEqual(copy.en, copy.es);
    }
  }
});

test("comparison copy preserves platform, scheduling and execution distinctions", () => {
  const hermes = comparisons.find((item) => item.slug === "hermes-agent");
  const openbot = comparisons.find((item) => item.slug === "openbot");
  const openclaw = comparisons.find((item) => item.slug === "openclaw");
  for (const lang of ["en", "es"]) {
    assert.match(apxRows[1][lang], /Android/);
    assert.doesNotMatch(apxRows[1][lang], /iOS|iPhone/);
    assert.match(
      hermes.rows[2][lang],
      lang === "en" ? /agent.*computer or a server.*Commands/ : /agente.*computadora o un servidor.*comandos/,
    );
    for (const platform of ["Slack", "Discord", "Telegram"]) assert.ok(openbot.rows[5][lang].includes(platform));
    assert.match(openbot.rows[5][lang], lang === "en" ? /Scheduled routines/ : /Rutinas programadas/);
    assert.match(openbot.rows[7][lang], /PolyForm Noncommercial 1\.0\.0/);
    assert.doesNotMatch(openbot.rows[7][lang], /commercial use needs|uso comercial necesita/);
  }
  assert.ok(openclaw.rowSources[3].includes("https://docs.openclaw.ai/concepts/multi-agent"));
  assert.ok(openclaw.rowSources[5].includes("https://docs.openclaw.ai/automation/cron-jobs"));
});

test("GitHub evidence is pinned and license copy preserves exceptions", () => {
  assert.match(checked, /^\d{4}-\d{2}-\d{2}$/);
  const sources = [
    ...apxRowSources.flat(),
    ...comparisons.flatMap((item) => [item.license, item.detailSource, ...item.rowSources.flat()]),
  ];
  for (const source of sources) {
    const url = new URL(source);
    if (url.hostname !== "github.com") continue;
    const [owner, repo, kind, revision] = url.pathname.split("/").slice(1);
    if (kind !== "blob") continue;
    assert.match(revision, /^[a-f0-9]{40}$/);
    assert.equal(revision, sourceSnapshots[`${owner}/${repo}`]);
  }
  const openbot = comparisons.find((item) => item.slug === "openbot");
  assert.match(openbot.rows[7].en, /may require separate permission/);
  assert.match(openbot.rows[7].es, /puede requerir otra autorización/);
});

test("navigation and editorial labels are available in both languages", () => {
  assert.deepEqual(Object.keys(labels.en).sort(), Object.keys(labels.es).sort());
  for (const lang of ["en", "es"]) for (const value of Object.values(labels[lang])) assert.ok(value.trim());
});
