import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareVersions,
  coreBundleName,
  desktopAssetFor,
  fetchReleases,
  newerReleases,
  parseSha256,
  platformOf,
} from "./releases.ts";

const asset = (name: string) => ({ name, browser_download_url: `https://example.com/${name}` });

test("versions compare by x.y.z, a dev build by the tag it came from", () => {
  assert.ok(compareVersions("2.1.10", "2.1.9") > 0);
  assert.ok(compareVersions("v2.0.3", "2.1.0") < 0);
  assert.equal(compareVersions("2.1.2-dev.40+d85585f", "2.1.2"), 0);
  assert.equal(compareVersions("nonsense", "2.0.0"), 0);
});

test("only published vX.Y.Z releases newer than this one count, newest first", () => {
  const list = [
    { tag_name: "v2.3.0", draft: true, assets: [] },
    { tag_name: "v2.2.0-beta.1", prerelease: true, assets: [] },
    {
      tag_name: "v2.1.0",
      body: "## What's Changed\n* feat: sidebar sections by @someone in https://x/1\n- fix: `apx` on PATH\n",
      assets: [asset("a")],
    },
    { tag_name: "v2.2.0", body: "", assets: [] },
    { tag_name: "v1.123.1", assets: [] },
    { tag_name: "android-latest", assets: [] },
    { tag_name: "v2.0.3", assets: [] },
  ];
  const out = newerReleases(list, "2.0.3");
  assert.deepEqual(
    out.map((r) => r.version),
    ["2.2.0", "2.1.0"],
  );
  assert.deepEqual(out[1]?.notes, ["feat: sidebar sections", "fix: apx on PATH"]);
  assert.deepEqual(out[1]?.assets, [{ name: "a", url: "https://example.com/a" }]);
  assert.deepEqual(newerReleases({ message: "rate limited" }, "2.0.0"), []);
});

test("each platform finds its own installer and daemon bundle", () => {
  const assets = [
    "APX-2.2.0-linux-x86_64.AppImage",
    "APX-2.2.0-mac-arm64.dmg",
    "APX-2.2.0-mac-arm64.zip",
    "APX-2.2.0-win-x64.exe",
  ].map((n) => ({
    name: n,
    url: n,
  }));
  const linux = platformOf("linux", "x64");
  const mac = platformOf("darwin", "arm64");
  assert.ok(linux && mac);
  assert.equal(desktopAssetFor(assets, "2.2.0", linux)?.name, "APX-2.2.0-linux-x86_64.AppImage");
  assert.equal(desktopAssetFor(assets, "2.2.0", mac)?.name, "APX-2.2.0-mac-arm64.dmg");
  assert.equal(desktopAssetFor(assets, "2.2.1", mac), undefined);
  assert.equal(desktopAssetFor(assets, "2.2.0", mac, "zip")?.name, "APX-2.2.0-mac-arm64.zip");
  assert.equal(coreBundleName("2.2.0", linux), "apx-core-2.2.0-linux-x64.tar.gz");
  assert.equal(platformOf("freebsd", "x64"), undefined);
  assert.equal(platformOf("linux", "ia32"), undefined);
});

test("the feed is a GitHub repo, or the base URL of a feed shaped like its API", async () => {
  const asked: string[] = [];
  const fake = (async (url: string) => {
    asked.push(url);
    return new Response("[]");
  }) as typeof fetch;
  await fetchReleases("acme/apx", fake);
  await fetchReleases("http://127.0.0.1:7499/", fake);
  assert.deepEqual(asked, [
    "https://api.github.com/repos/acme/apx/releases?per_page=30",
    "http://127.0.0.1:7499/releases?per_page=30",
  ]);
});

test("a .sha256 file gives its digest", () => {
  const hex = "a".repeat(64);
  assert.equal(parseSha256(`${hex}  apx-core-2.2.0-linux-x64.tar.gz\n`), hex);
  assert.equal(parseSha256("not a digest"), undefined);
});
