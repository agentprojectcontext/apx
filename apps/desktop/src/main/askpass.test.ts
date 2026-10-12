import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { classifyPrompt, nodeHelper, openAskpass, type Prompt, requestAnswer, runAskpass } from "./askpass.ts";

test("a password or passphrase is masked; the host key's yes/no is typed in the clear", () => {
  assert.equal(classifyPrompt("ops@box's password: ").secret, true);
  assert.equal(classifyPrompt("Enter passphrase for key '/home/ops/.ssh/id_ed25519': ").secret, true);
  assert.equal(classifyPrompt("(ops@box) Password: ").secret, true);
  const hostKey = classifyPrompt(
    "The authenticity of host 'box (10.0.0.5)' can't be established.\r\nED25519 key fingerprint is SHA256:abc.\r\n" +
      "Are you sure you want to continue connecting (yes/no/[fingerprint])? ",
  );
  assert.equal(hostKey.secret, false);
  assert.equal(hostKey.text.split("\n").length, 3);
});

test("a prompt loses terminal escapes and control characters before it reaches the screen", () => {
  assert.equal(classifyPrompt("\u001b[31mPassword:\u001b[0m\u0000 \u0008").text, "Password: ");
});

test("ssh's question goes over the socket and the owner's answer comes back on stdout", async () => {
  const asked: Prompt[] = [];
  const pass = await openAskpass({
    ask: async (p) => {
      asked.push(p);
      return "s3cret";
    },
    exe: process.execPath,
  });
  try {
    // On Linux ssh runs the Node helper instead (see the last test).
    if (process.platform === "linux") assert.match(pass.env.SSH_ASKPASS ?? "", /askpass\.sh$/);
    else assert.equal(pass.env.SSH_ASKPASS, process.execPath);
    assert.equal(pass.env.SSH_ASKPASS_REQUIRE, "force");
    const out = new PassThrough();
    let printed = "";
    out.on("data", (d: Buffer) => {
      printed += d.toString();
    });
    const code = await runAskpass(pass.env, ["exe", "ops@box's password: "], out);
    assert.equal(code, 0);
    assert.equal(printed, "s3cret\n");
    assert.deepEqual(asked, [{ text: "ops@box's password: ", secret: true }]);
  } finally {
    pass.close();
  }
});

test("a cancelled question exits 1 and prints nothing; a wrong key gets no answer at all", async () => {
  let calls = 0;
  const pass = await openAskpass({
    ask: async () => {
      calls++;
      return undefined;
    },
    exe: process.execPath,
  });
  try {
    const out = new PassThrough();
    let printed = "";
    out.on("data", (d: Buffer) => {
      printed += d.toString();
    });
    assert.equal(await runAskpass(pass.env, ["exe", "Password: "], out), 1);
    assert.equal(printed, "");
    assert.equal(await requestAnswer(pass.env.APX_ASKPASS ?? "", "0".repeat(48), "Password: "), undefined);
    assert.equal(calls, 1);
  } finally {
    pass.close();
  }
});

test("from a checkout, ssh runs a wrapper that hands Electron the app's folder; it goes away with the login", async (t) => {
  if (process.platform === "win32") return t.skip("the wrapper is a shell script");
  if (process.platform === "linux") return t.skip("Linux uses the Node helper, checkout or not");
  const pass = await openAskpass({ ask: async () => "x", exe: "/opt/Acme Apps/electron", appDir: "/work/it's/apx" });
  const wrapper = pass.env.SSH_ASKPASS ?? "";
  try {
    assert.match(
      fs.readFileSync(wrapper, "utf8"),
      /^#!\/bin\/sh\nexec '\/opt\/Acme Apps\/electron' '\/work\/it'\\''s\/apx' "\$@"\n$/,
    );
    assert.equal(fs.statSync(wrapper).mode & 0o777, 0o700);
  } finally {
    pass.close();
  }
  assert.equal(fs.existsSync(wrapper), false);
  assert.equal(fs.existsSync(pass.env.APX_ASKPASS ?? ""), false);
});

test("on Linux ssh runs the app as Node over a small helper: the question and the answer make the same round trip", async (t) => {
  if (process.platform === "win32") return t.skip("the helper is a shell script");
  const asked: string[] = [];
  const pass = await openAskpass({
    ask: async (p) => {
      asked.push(p.text);
      return "s3cret";
    },
    exe: process.execPath,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-helper-"));
  try {
    const helper = nodeHelper(dir, process.execPath);
    const run = (env: Record<string, string>) =>
      new Promise<{ code: number; out: string }>((resolve) =>
        execFile(helper, ["ops@box's password: "], { env: { ...process.env, ...env } }, (err, out) =>
          resolve({ code: err ? Number(err.code ?? 1) : 0, out }),
        ),
      );
    assert.deepEqual(await run(pass.env), { code: 0, out: "s3cret\n" });
    assert.deepEqual(asked, ["ops@box's password: "]);
    // A wrong key gets nothing: ssh hears there is no answer.
    assert.equal((await run({ ...pass.env, APX_ASKPASS_KEY: "0".repeat(48) })).code, 1);
  } finally {
    pass.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
