import assert from "node:assert/strict";
import { test } from "node:test";
import { askpassSupported, authorizeCommand, loginArgs, opensshVersion, publicKeyLine } from "./ssh-login.ts";
import { needsPassword } from "./ssh-tunnel.ts";

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGm0Zk7dQ1x2y3z4A5B6C7D8E9F0a1b2c3d4e5f6g7h8 apx-desktop";

test("a login that failed because the server wants a password is told apart from any other failure", () => {
  assert.equal(needsPassword(255, "root@vps: Permission denied (publickey,password).\n"), true);
  assert.equal(needsPassword(255, "ops@box: Permission denied (publickey,keyboard-interactive).\n"), true);
  assert.equal(needsPassword(255, "ops@box: Permission denied (publickey).\n"), false);
  assert.equal(needsPassword(255, "ssh: connect to host box port 22: Connection refused\n"), false);
  assert.equal(needsPassword(1, "Permission denied (publickey,password)."), false);
});

test("askpass needs OpenSSH 8.4 or newer, on every system's build", () => {
  assert.deepEqual(opensshVersion("OpenSSH_9.6p1 Ubuntu-3ubuntu13, OpenSSL 3.0.13"), [9, 6]);
  assert.deepEqual(opensshVersion("OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2"), [9, 5]);
  assert.equal(askpassSupported(opensshVersion("OpenSSH_8.4p1")), true);
  assert.equal(askpassSupported(opensshVersion("OpenSSH_10.0p2")), true);
  assert.equal(askpassSupported(opensshVersion("OpenSSH_8.2p1")), false);
  assert.equal(askpassSupported(opensshVersion("Dropbear")), false);
});

test("the key goes into authorized_keys once, quoted as one word", () => {
  const command = authorizeCommand(KEY);
  assert.ok(command.includes(`grep -qxF '${KEY}' ~/.ssh/authorized_keys`));
  assert.ok(command.includes(`echo '${KEY}' >> ~/.ssh/authorized_keys`));
  assert.ok(command.endsWith("echo APX_KEY_OK"));
});

test("anything but one plain ed25519 key line is refused before it reaches a remote shell", () => {
  for (const bad of [
    `${KEY}'; rm -rf ~ #`,
    `${KEY}\nssh-ed25519 AAAA other`,
    "ssh-rsa AAAAB3NzaC1yc2E user",
    "ssh-ed25519 AAAA$(id) x",
    `${KEY} `,
  ]) {
    assert.throws(() => authorizeCommand(bad), /plain ed25519/);
  }
  assert.equal(publicKeyLine(`${KEY}\n`), KEY);
  assert.equal(publicKeyLine("ssh-ed25519 AAAA`id`"), undefined);
});

test("the one interactive login may ask (host key, password); the port comes from the target", () => {
  const args = loginArgs("root@vps:2222", "true");
  assert.ok(args.includes("BatchMode=no"));
  assert.ok(args.includes("StrictHostKeyChecking=ask"));
  assert.deepEqual(args.slice(-5), ["-p", "2222", "--", "root@vps", "true"]);
});
