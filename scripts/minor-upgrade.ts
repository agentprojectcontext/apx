import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions } from "../packages/protocol/src/releases.ts";
import { previousRelease, type ReleaseRow } from "./release-previous.ts";
import { upgradeDesktop } from "./upgrade-desktop.ts";
import { bundledCore, command, previousArtifacts, releaseFixture, stop } from "./upgrade-fixture.ts";

export function upgradeArgs(args: string[]) {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (
      !key ||
      !["--previous", "--target", "--candidate", "--report", "--repo"].includes(key) ||
      !value ||
      value.startsWith("--") ||
      values.has(key)
    )
      throw new Error(
        "Usage: minor-upgrade --previous x.y.z --target x.y.z --candidate out --report result.json [--repo owner/repo]",
      );
    values.set(key, value);
  }
  for (const key of ["--previous", "--target", "--candidate", "--report"])
    if (!values.has(key)) throw new Error(`missing ${key}`);
  const previous = values.get("--previous") ?? "";
  const target = values.get("--target") ?? "";
  if (!/^2\.\d+\.\d+$/.test(previous) || !/^2\.\d+\.\d+$/.test(target) || compareVersions(target, previous) <= 0)
    throw new Error("previous and target must be increasing v2 versions without a v prefix");
  return {
    previous,
    target,
    candidate: path.resolve(values.get("--candidate") ?? ""),
    report: path.resolve(values.get("--report") ?? ""),
    repo: values.get("--repo") ?? "agentprojectcontext/apx",
  };
}

type Options = ReturnType<typeof upgradeArgs>;

async function upgradeCore(o: Options, work: string, feed: string) {
  const home = path.join(work, "core-home");
  const app = path.join(home, "app");
  const versions = path.join(app, "versions");
  fs.mkdirSync(versions, { recursive: true });
  await command("tar", ["-xf", path.join(work, "previous", `apx-core-${o.previous}-mac-arm64.tar.gz`), "-C", versions]);
  fs.renameSync(path.join(versions, "apx"), path.join(versions, o.previous));
  fs.symlinkSync(`versions/${o.previous}`, path.join(app, "current"));
  const env = {
    ...process.env,
    APX_HOME: home,
    APX_APP: app,
    APX_PORT: "0",
    APX_URL: undefined,
    APX_RELEASES: feed,
    APX_TELEMETRY: "off",
    APX_RUNTIME_SKILLS: "off",
    APX_CHROME_HOST: "off",
    APX_CODE_SHA: undefined,
  };
  let active = await bundledCore(path.join(app, "current"), env, path.join(work, "previous-core.log"));
  try {
    const before = await active.client.call("system.health", {});
    assert.equal(before.version, o.previous);
    const { agents } = await active.client.call("agents.list", {});
    const agent = agents.find((a) => a.kind === "secretary") ?? agents[0];
    assert.ok(agent);
    const thread = await active.client.call("threads.create", {
      kind: "loose",
      agent_id: agent.id,
      title: "Upgrade preserved chat",
    });
    env.APX_PORT = new URL(active.url).port;
    await stop(active.child);
    const old = path.join(versions, o.previous);
    const log = await command(
      path.join(old, "node/bin/node"),
      [path.join(old, "apps/terminal/src/main.ts"), "upgrade"],
      { env, ms: 300_000 },
    );
    fs.writeFileSync(path.join(work, "installed-updater.log"), log);
    assert.equal(path.basename(fs.realpathSync(path.join(app, "current"))), o.target);
    active = await bundledCore(path.join(app, "current"), env, path.join(work, "candidate-core.log"));
    const after = await active.client.call("system.health", {});
    const expected = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim();
    assert.equal(after.version, o.target);
    assert.equal(after.code_sha, expected);
    assert.equal(after.home_id, before.home_id);
    assert.equal(
      (await active.client.call("threads.get", { thread: thread.id })).thread.title,
      "Upgrade preserved chat",
    );
    return {
      active,
      thread: thread.id,
      result: { installed_updater: true, health: true, data_preserved: true, before, after },
    };
  } catch (error) {
    await stop(active.child);
    throw error;
  }
}

export async function runUpgrade(o: Options) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("This native matrix currently requires macOS arm64. Other platforms remain unverified.");
  fs.mkdirSync(path.dirname(o.report), { recursive: true });
  const work = fs.mkdtempSync(path.join(path.dirname(o.report), "upgrade-"));
  const report: Record<string, unknown> = {
    schema: 1,
    previous: o.previous,
    target: o.target,
    candidate_commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    platform: "mac-arm64",
    isolated: true,
    work,
    commands: [
      "gh release download (previous daemon and desktop ZIP with sidecars)",
      "previous bundled apx upgrade against isolated artifact feed",
      "native desktop installUpdate and restartToUpdate",
      "OS open relaunch with isolated profile",
      "reconnected client threads.get",
    ],
  };
  let feed: Awaited<ReturnType<typeof releaseFixture>> | undefined;
  let core: Awaited<ReturnType<typeof upgradeCore>> | undefined;
  const save = () => fs.writeFileSync(o.report, JSON.stringify(report, null, 2));
  try {
    const releases = await command("gh", [
      "api",
      "--paginate",
      `repos/${o.repo}/releases?per_page=100`,
      "--jq",
      ".[] | {tag_name, draft}",
    ]);
    const previous = previousRelease(
      `v${o.target}`,
      releases
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as ReleaseRow),
    );
    assert.equal(previous, `v${o.previous}`, "matrix must start from the previous published release");
    report.previous_artifacts = await previousArtifacts(o.previous, path.join(work, "previous"), o.repo);
    feed = await releaseFixture(o.candidate, o.target);
    report.candidate_artifacts = feed.assets;
    const desktopBuild = JSON.parse(
      execFileSync(
        "unzip",
        ["-p", path.join(o.candidate, `APX-${o.target}-mac-arm64.zip`), "APX.app/Contents/Resources/apx/build.json"],
        { encoding: "utf8" },
      ),
    ) as { version: string; sha: string };
    assert.equal(desktopBuild.version, o.target);
    assert.equal(
      desktopBuild.sha,
      String(report.candidate_commit).slice(0, 12),
      "desktop and core artifacts must match the matrix commit",
    );
    save();
    core = await upgradeCore(o, work, feed.url);
    report.core = core.result;
    save();
    const clientHome = path.join(work, "client-home");
    fs.mkdirSync(clientHome);
    await command("ditto", ["-xk", path.join(work, "previous", `APX-${o.previous}-mac-arm64.zip`), clientHome]);
    report.desktop = await upgradeDesktop({
      bundle: path.join(clientHome, "APX.app"),
      home: clientHome,
      url: core.active.url,
      feed: feed.url,
      target: o.target,
      previous: o.previous,
      client: core.active.client,
      thread: core.thread,
    });
    report.passed = true;
    save();
  } catch (error) {
    report.passed = false;
    report.error = error instanceof Error ? error.stack : String(error);
    save();
    throw error;
  } finally {
    if (core) await stop(core.active.child);
    if (feed) await feed.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runUpgrade(upgradeArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
