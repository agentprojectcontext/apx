import assert from "node:assert/strict";
import fs from "node:fs";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { classifyPrompt, openAskpass, type Prompt, requestAnswer, runAskpass } from "./askpass.ts";

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
    assert.equal(pass.env.SSH_ASKPASS, process.execPath);
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

test("from a checkout, ssh runs a wrapper that hands Electron the app's folder; it goes away with the login", async () => {
  if (process.platform === "win32") return;
  const pass = await openAskpass({ ask: async () => "x", exe: "/opt/Acme Apps/electron", appDir: "/work/it's/apx" });
  const wrapper = pass.env.SSH_ASKPASS ?? "";
  assert.match(
    fs.readFileSync(wrapper, "utf8"),
    /^#!\/bin\/sh\nexec '\/opt\/Acme Apps\/electron' '\/work\/it'\\''s\/apx' "\$@"\n$/,
  );
  assert.equal(fs.statSync(wrapper).mode & 0o777, 0o700);
  pass.close();
  assert.equal(fs.existsSync(wrapper), false);
  assert.equal(fs.existsSync(pass.env.APX_ASKPASS ?? ""), false);
});
