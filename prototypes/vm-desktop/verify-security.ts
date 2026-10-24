import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { verifyGuest } from "../../apps/core/src/environments/guest-security.ts";
import { limaProcess } from "../../apps/core/src/environments/lima-process.ts";
import { agentLoopbackRules, LOOPBACK_RULES } from "../../apps/core/src/environments/loopback.ts";
import { screenArgs, workerArgs } from "../../apps/core/src/environments/worker.ts";
import { findProgram, withUsualDirs } from "../../apps/core/src/programs.ts";
import { ApxClient } from "../../packages/protocol/src/client.ts";

const runtime = path.resolve(process.argv[2] ?? "");
if (!path.basename(runtime).startsWith("apx-vm-lab-")) throw new Error("Use an isolated apx-vm-lab-* runtime");
const { url } = JSON.parse(fs.readFileSync(path.join(runtime, "running.json"), "utf8")) as { url: string };
const client = new ApxClient({ url: new URL(url).origin });
const status = await client.call("environments.status", {});
const chat = status.chats?.[0];
assert.ok(status.ready && chat, "Start the protected lab computer first");
const { runs } = await client.call("threads.get", { thread: chat });
assert.ok(
  runs.every((run) => run.ended_at),
  "Wait for active agent work before testing",
);
const env = { PATH: withUsualDirs(process.env.PATH ?? ""), HOME: os.homedir(), LIMA_HOME: path.join(runtime, "lima") };
const binary = findProgram("limactl", env.PATH) ?? path.join(runtime, "core/computer/lima-2.2.1/bin/limactl");
const run = limaProcess(() => binary, env);
await verifyGuest(run, status.name);
let hits = 0;
const canary = http.createServer((_req, res) => {
  hits++;
  res.end("Acme host boundary test");
});
canary.listen(0, "0.0.0.0");
await once(canary, "listening");
const address = canary.address();
assert.ok(address && typeof address !== "string");
try {
  const output = await run(
    [
      "shell",
      status.name,
      "--",
      ...workerArgs(
        "python3",
        "-c",
        `
import os,socket,urllib.request,urllib.error,subprocess
assert os.getuid()==1001
assert subprocess.run(['sudo','-n','true'],capture_output=True).returncode!=0
for name in ['/home/apx/password','/mnt/lima-cidata','/run/user/1000']:
 assert not os.access(name,os.R_OK),name
for target in [('192.168.5.2',${address.port}),('192.168.5.2',22),('1.1.1.1',443),('10.0.0.1',80)]:
 s=socket.socket();s.settimeout(2);code=s.connect_ex(target);s.close();assert code in (1,13,113),(target,code)
web=urllib.request.build_opener(urllib.request.ProxyHandler({'http':'http://127.0.0.1:3128','https':'http://127.0.0.1:3128'}))
for url in ['http://192.168.5.2:${address.port}/','https://192.168.5.2:${address.port}/','http://[::ffff:7f00:1]:${address.port}/']:
 try:web.open(url,timeout=5);raise AssertionError('private destination allowed')
 except (urllib.error.HTTPError,urllib.error.URLError) as failure:assert '403' in str(failure),str(failure)
assert web.open('https://example.com',timeout=20).status==200
print('Verified worker privileges, administrator boundaries, direct egress rejection and public-only HTTP(S) proxy')
`,
      ),
    ],
    { timeout: 45_000 },
  );
  assert.equal(hits, 0, "The host canary must receive no guest requests");
  process.stdout.write(`${output.trim()}\nVerified: host canary received zero requests.\n`);
} finally {
  await new Promise<void>((resolve) => canary.close(() => resolve()));
}

// Loopback between agents (DECISIONS.md#d-152): agent A (screen 1) listens on 127.0.0.1 and ::1; agent B (screen 2)
// is refused on both, while A reaches its own listener.
const admin = (args: string[], input?: string) =>
  run(["shell", status.name, "--", ...args], { input, timeout: 60_000 });
for (const screen of [1, 2]) await admin(["sudo", "-n", "/usr/local/libexec/apx-computer-user", String(screen)]);
await admin(["sudo", "-n", "tee", LOOPBACK_RULES], agentLoopbackRules([1, 2]));
await admin(["sudo", "-n", "/usr/local/libexec/apx-computer-firewall"]);
const port = 47011;
const listening = run(
  [
    "shell",
    status.name,
    "--",
    ...screenArgs(
      1,
      "python3",
      "-c",
      `
import socket,threading,time
def serve(family,host):
  s=socket.socket(family);s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind((host,${port}));s.listen()
  s.settimeout(20)
  try:
    while True:c,_=s.accept();c.sendall(b'mine');c.close()
  except socket.timeout:pass
for f,h in ((socket.AF_INET,'127.0.0.1'),(socket.AF_INET6,'::1')):threading.Thread(target=serve,args=(f,h),daemon=True).start()
time.sleep(15)`,
    ),
  ],
  { timeout: 30_000 },
);
await new Promise((resolve) => setTimeout(resolve, 2000));
const probe = (screen: number) =>
  run(
    [
      "shell",
      status.name,
      "--",
      ...screenArgs(
        screen,
        "python3",
        "-c",
        `
import socket
for f,h in ((socket.AF_INET,'127.0.0.1'),(socket.AF_INET6,'::1')):
  s=socket.socket(f);s.settimeout(3)
  try:s.connect((h,${port}));print(h,s.recv(4).decode())
  except OSError as e:print(h,'refused',type(e).__name__)`,
      ),
    ],
    { timeout: 20_000 },
  );
const own = await probe(1);
const other = await probe(2);
await listening.catch(() => "");
assert.match(own, /127\.0\.0\.1 mine\n::1 mine/, `agent A must reach its own listener: ${own}`);
assert.match(other, /127\.0\.0\.1 refused[^\n]*\n::1 refused/, `agent B must be refused: ${other}`);
process.stdout.write("Verified: an agent's loopback listener refuses another agent and serves its own.\n");
