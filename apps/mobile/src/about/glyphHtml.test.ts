import assert from "node:assert/strict";
import { test } from "node:test";
import { blobEyes } from "../ui/blobEyes.ts";
import { faces } from "./faces.ts";
import { glyphHtml } from "./glyphHtml.ts";
import { scenesFor } from "./scenes.ts";

test("the portrait page carries every face it draws and loads nothing from outside", () => {
  for (const lang of ["en", "es"] as const) {
    const scenes = scenesFor(lang);
    for (const scene of scenes) assert.ok(faces[scene.key]?.startsWith("data:image/webp;base64,"), scene.key);
    const html = glyphHtml({ scenes, faces, eyes: blobEyes, caption: "APX version 2.0.2", background: "#161615" });
    assert.doesNotMatch(html, /(src|href)=["']?https?:/);
    assert.doesNotMatch(html, /<\/script>[\s\S]*<\/script>/);
    for (const scene of scenes) assert.ok(html.includes(JSON.stringify(scene.key)), scene.key);
    assert.ok(html.includes("APX version 2.0.2"));
  }
});
