import fs from "node:fs";
import path from "node:path";
import type { LimaRun } from "./lima-process.ts";
import { workerArgs } from "./worker.ts";

const ASSETS = path.join(import.meta.dirname, "guest");
export async function secureGuest(run: LimaRun, instance: string, signal?: AbortSignal) {
  await run(["shell", instance, "--", "sudo", "-n", "sh", "-s"], {
    input: fs.readFileSync(path.join(ASSETS, "security.sh")),
    signal,
  });
  await verifyGuest(run, instance, signal);
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
assert len(expressions)==2
assert expressions[0][0]['match']['right']==1001 and expressions[0][1]['match']['right']=='lo'
assert 'accept' in expressions[0][2]
assert expressions[1][0]['match']['right']==1001 and 'reject' in expressions[1][1]
forward=[r['chain'] for r in rules['nftables'] if 'chain' in r and r['chain']['name']=='forward']
assert len(forward)==1 and forward[0]['policy']=='drop'
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
