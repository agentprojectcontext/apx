import fs from "node:fs";
import path from "node:path";
import type { LimaRun } from "./lima-process.ts";
import { workerArgs } from "./worker.ts";

const ASSETS = path.join(import.meta.dirname, "guest");
const USERS = ["1001", "2001-2999"];

/**
 * The probe user and every agent reach only loopback, and never a resolver there (systemd-resolved's 127.0.0.53):
 * names are the egress proxy's to resolve, so no DNS gets past its public-only policy.
 */
export const egressRules = () =>
  [
    "table inet apx_computer {",
    "  chain output {",
    "    type filter hook output priority -150; policy accept;",
    ...USERS.flatMap((u) => [
      `    meta skuid ${u} oifname "lo" meta l4proto { tcp, udp } th dport 53 reject with icmpx type admin-prohibited`,
      `    meta skuid ${u} oifname "lo" accept`,
      `    meta skuid ${u} reject with icmpx type admin-prohibited`,
    ]),
    "  }",
    "  chain forward {",
    "    type filter hook forward priority -150; policy drop;",
    "  }",
    "}",
    "",
  ].join("\n");

export async function secureGuest(run: LimaRun, instance: string, signal?: AbortSignal) {
  await run(["shell", instance, "--", "sudo", "-n", "install", "-d", "-m", "755", "/etc/apx-computer"], { signal });
  await run(["shell", instance, "--", "sudo", "-n", "tee", "/etc/apx-computer/egress.nft"], {
    input: egressRules(),
    signal,
  });
  await run(["shell", instance, "--", "sudo", "-n", "sh", "-s"], {
    input: fs.readFileSync(path.join(ASSETS, "security.sh")),
    signal,
  });
  await verifyGuest(run, instance, signal);
}

/** A computer set up before a boundary was added gets it now: the security script is safe to run again. */
export async function ensureSecured(prepared: boolean, run: LimaRun, instance: string, signal?: AbortSignal) {
  const secured =
    prepared &&
    (await verifyGuest(run, instance, signal).then(
      () => true,
      () => false,
    ));
  if (!secured) await secureGuest(run, instance, signal);
}

/** No marker alone grants readiness: validate privileges, home boundary and installed firewall over SSH. */
export async function verifyGuest(run: LimaRun, instance: string, signal?: AbortSignal) {
  const output = await run(
    [
      "shell",
      instance,
      "--",
      "sudo",
      "-n",
      "python3",
      "-c",
      `
import json,os,pwd,subprocess
from pathlib import Path
u=pwd.getpwnam('apx-worker')
assert u.pw_uid==1001 and u.pw_dir=='/home/apx-worker'
assert oct(Path('/home/apx').stat().st_mode & 0o777)=='0o700'
assert Path('/etc/apx-computer/egress.nft').stat().st_uid==0
assert Path('/etc/apx-computer/egress.nft').stat().st_mode & 0o022==0
rules=json.loads(subprocess.check_output(['nft','-j','list','table','inet','apx_computer']))
expressions=[r['rule']['expr'] for r in rules['nftables'] if 'rule' in r and r['rule']['chain']=='output']
assert len(expressions)==6
for first,owner in ((0,1001),(3,{'range':[2001,2999]})):
  dns,lo,rest=expressions[first:first+3]
  assert dns[0]['match']['right']==owner and dns[1]['match']['right']=='lo' and 'reject' in dns[-1]
  assert any(e.get('match',{}).get('right')==53 for e in dns)
  assert lo[0]['match']['right']==owner and lo[1]['match']['right']=='lo' and 'accept' in lo[2]
  assert rest[0]['match']['right']==owner and 'reject' in rest[1]
forward=[r['chain'] for r in rules['nftables'] if 'chain' in r and r['chain']['name']=='forward']
assert len(forward)==1 and forward[0]['policy']=='drop'
egress=Path('/run/apx-egress').stat()
assert egress.st_uid==1000 and egress.st_mode & 0o777==0o700
listen=subprocess.check_output(['ss','-Hltnp','src','127.0.0.1:3128'],text=True).strip().splitlines()
assert len(listen)==1 and 'pid=1,' in listen[0]
assert subprocess.run(['systemctl','is-enabled','--quiet','apx-agents-boot.service']).returncode==0
r=subprocess.run(['sudo','-n','-u','apx-worker','sudo','-n','true'],capture_output=True)
assert r.returncode!=0
print('isolated')`,
    ],
    { signal, timeout: 10_000 },
  );
  if (output.trim() !== "isolated") throw new Error("Computer security validation failed");
  await run(
    [
      "shell",
      instance,
      "--",
      ...workerArgs(
        "python3",
        "-c",
        "import os,socket;assert os.getuid()==1001;assert not os.access('/home/apx/password',os.R_OK);s=socket.socket();s.settimeout(1);code=s.connect_ex(('192.168.5.2',9));assert code in (1,13,113),code",
      ),
    ],
    { signal, timeout: 5000 },
  );
}
