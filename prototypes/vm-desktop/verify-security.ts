import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { verifyGuest } from "../../apps/core/src/environments/guest-security.ts";
import { limaProcess } from "../../apps/core/src/environments/lima-process.ts";
import { workerArgs } from "../../apps/core/src/environments/worker.ts";
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
