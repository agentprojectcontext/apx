import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import { ObserverReader } from "./observer-reader.ts";
import type { ObserverClock, ObserverCommand } from "./owned-observer.ts";

const command: ObserverCommand = { op: "listWindows", pid: 42, launchIdentity: { seconds: 100, microseconds: 0 } };
function reader(mutation = "", clock?: ObserverClock) {
  const script = `import readline from 'node:readline';
import {randomUUID} from 'node:crypto';
let n=0; const session=randomUUID(); let handle;
readline.createInterface({input:process.stdin}).on('line',line=>{
  if(n++===0) return process.stdout.write('{"version":1,"ready":true}\\n');
  const {requestID,command}=JSON.parse(line); const generation=randomUUID();
  const identity={session,generation,pid:command.pid,launchIdentity:command.launchIdentity};
  let result;
  if(command.op==='listWindows'){
    handle=session+':'+generation+':'+randomUUID();
    result={version:1,generation,listing:{...identity,windows:[{handle,title:'Acme',ambiguous:false}]}};
  } else {
    result={version:1,generation,selectedObservation:{...identity,handle,association:'ax-only-no-capture-or-coordinates',
      nodes:[{ref:session+':'+generation+':0',role:'AXWindow',redacted:false,children:[]}]}};
  }
  ${mutation}
  process.stdout.write(JSON.stringify({requestID,result})+'\\n');
});`;
  return new ObserverReader({
    executable: process.execPath,
    home: os.tmpdir(),
    args: ["--input-type=module", "-e", script],
    ...(clock ? { clock } : {}),
  });
}

test("the private reader exercises correlated subprocess listing and retained observation", async () => {
  const subject = reader();
  try {
    const listed = await subject.request(command);
    assert.equal(listed.kind, "listing");
    if (listed.kind !== "listing") throw new Error("Expected listing");
    const handle = listed.windows[0]?.handle;
    assert.ok(handle);
    const observed = await subject.request({ ...command, op: "observeSelected", handle });
    assert.equal(observed.kind, "observation");
    if (observed.kind !== "observation") throw new Error("Expected observation");
    assert.equal(observed.handle, handle);
    assert.equal(observed.nodes.length, 1);
  } finally {
    await subject.stop();
  }
  await assert.rejects(subject.request(command), /^Error: OBSERVER_READ_FAILED$/);
});

for (const mutation of [
  "result.listing.pid++;",
  "result.listing.windows[0].title='PRIVATE_MARKER'.repeat(20);",
  "result.listing.value='PRIVATE_MARKER';",
  "result.listing.windows[0].handle='PRIVATE_MARKER';",
]) {
  test(`invalid subprocess results stop the session without exposing raw content: ${mutation.split("=")[0]}`, async () => {
    const subject = reader(mutation);
    try {
      await assert.rejects(subject.request(command), /^Error: OBSERVER_READ_FAILED$/);
      await assert.rejects(subject.request(command), /^Error: OBSERVER_READ_FAILED$/);
    } finally {
      await subject.stop();
    }
  });
}

test("the caller copies command identity before awaiting the subprocess", async () => {
  const subject = reader();
  const mutable = { ...command, launchIdentity: { ...command.launchIdentity } };
  try {
    const pending = subject.request(mutable);
    mutable.pid++;
    mutable.launchIdentity.seconds++;
    const result = await pending;
    assert.equal(result.kind, "listing");
  } finally {
    await subject.stop();
  }
});

test("concurrent caller requests refuse busy without retiring the admitted read", async () => {
  const subject = reader();
  try {
    const pending = subject.request(command);
    await assert.rejects(subject.request(command), /^Error: OBSERVER_BUSY$/);
    assert.equal((await pending).kind, "listing");
  } finally {
    await subject.stop();
  }
});

test("stop during initialization prevents a validated response", async () => {
  const subject = reader();
  const pending = subject.request(command);
  const rejected = assert.rejects(pending, /^Error: OBSERVER_READ_FAILED$/);
  await subject.stop();
  await rejected;
});

test("stop after transport admission cannot publish a pending observation", async () => {
  let calls = 0;
  let acknowledgeAdmission: () => void = () => {};
  const admitted = new Promise<void>((resolve) => {
    acknowledgeAdmission = resolve;
  });
  const callbacks = new Set<() => void>();
  const subject = reader("if(command.op==='observeSelected')return;", {
    after(_ms, callback) {
      callbacks.add(callback);
      // The third timer belongs to the observation after hello and listing.
      if (++calls === 3) queueMicrotask(acknowledgeAdmission);
      return () => {
        callbacks.delete(callback);
      };
    },
  });
  try {
    const listed = await subject.request(command);
    assert.equal(listed.kind, "listing");
    if (listed.kind !== "listing") throw new Error("Expected listing");
    const handle = listed.windows[0]?.handle;
    assert.ok(handle);
    const pending = subject.request({ ...command, op: "observeSelected", handle });
    const rejected = assert.rejects(pending, /^Error: OBSERVER_READ_FAILED$/);
    await admitted;
    assert.equal(callbacks.size, 1);
    await subject.stop();
    await rejected;
    assert.equal(callbacks.size, 0);
    await assert.rejects(subject.request(command), /^Error: OBSERVER_READ_FAILED$/);
  } finally {
    await subject.stop();
  }
});

test("an error response has no tree and the caller can explicitly relist", async () => {
  const subject = reader("if(n===2)result={version:1,generation,error:'UNAVAILABLE'};");
  try {
    assert.deepEqual(await subject.request(command), { kind: "error", code: "UNAVAILABLE" });
    assert.equal((await subject.request(command)).kind, "listing");
  } finally {
    await subject.stop();
  }
});

test("unknown retained handle is rejected locally before requesting observation", async () => {
  const subject = reader("if(command.op!=='listWindows')result={version:1,generation,error:'UNAVAILABLE'};");
  try {
    assert.equal((await subject.request(command)).kind, "listing");
    await assert.rejects(
      subject.request({ ...command, op: "observeSelected", handle: "foreign" }),
      /^Error: OBSERVER_READ_FAILED$/,
    );
  } finally {
    await subject.stop();
  }
});
