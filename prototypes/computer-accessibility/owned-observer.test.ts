import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";
import { type ObserverClock, OwnedObserver } from "./owned-observer.ts";

const command = { op: "listWindows" as const, pid: 1, launchIdentity: { seconds: 1, microseconds: 0 } };
const hello = 'process.stdout.write(\'{"version":1,"ready":true}\\n\');';

function fixture(onRequest: string, onHello = hello, timers?: ObserverClock) {
  const script = `import readline from 'node:readline';
let n=0;
readline.createInterface({input:process.stdin}).on('line',line=>{
  if(n++===0){if(line!==JSON.stringify({op:'hello'}))throw Error('bad handshake');${onHello}}
  else {
    const frame=JSON.parse(line);
    line=JSON.stringify(frame.command);
    const send=result=>process.stdout.write(JSON.stringify({requestID:frame.requestID,result})+'\\n');
    ${onRequest}
  }
});`;
  return new OwnedObserver({
    executable: process.execPath,
    home: os.tmpdir(),
    args: ["--input-type=module", "-e", script],
    ...(timers ? { clock: timers } : {}),
  });
}

function manualClock() {
  const callbacks = new Set<() => void>();
  return {
    after(_ms: number, callback: () => void) {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
    fire() {
      for (const callback of [...callbacks]) callback();
    },
    get size() {
      return callbacks.size;
    },
  };
}

test("owned helper performs a separate handshake and sequential requests without inherited environment", async () => {
  const observer = fixture(`send({version:1,op:JSON.parse(line).op,
    env:Object.keys(process.env).sort(),count:n});`);
  try {
    await observer.ready();
    const first = await observer.request(command);
    assert.equal(first.op, "listWindows");
    // Core Foundation adds this process-local key during Node startup on macOS.
    assert.deepEqual(first.env, [
      "HOME",
      "LANG",
      "LC_ALL",
      ...(process.platform === "darwin" ? ["__CF_USER_TEXT_ENCODING"] : []),
    ]);
    assert.equal(first.count, 2);
    assert.equal((await observer.request(command)).count, 3);
  } finally {
    await observer.stop();
  }
  await assert.rejects(observer.request(command), /OBSERVER_STOPPED/);
});

test("stop during an outstanding read is terminal and does not replay or restart", async () => {
  const timers = manualClock();
  const observer = fixture("", hello, timers);
  try {
    await observer.ready();
    const pending = observer.request(command);
    const rejected = assert.rejects(pending, /OBSERVER_STOPPED/);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(timers.size, 1);
    await observer.stop();
    await rejected;
    assert.equal(timers.size, 0);
    await observer.stop();
    await assert.rejects(observer.request(command), /OBSERVER_STOPPED/);
  } finally {
    await observer.stop();
  }
});

test("stop during initialization rejects readiness only after child closure", async () => {
  const observer = fixture("", "");
  const rejected = assert.rejects(observer.ready(), /OBSERVER_STOPPED/);
  await observer.stop();
  await rejected;
});

test("injected whole-request deadline kills the child, cancels timers and never replays", async () => {
  const timers = manualClock();
  const observer = fixture("", hello, timers);
  try {
    await observer.ready();
    const pending = observer.request(command);
    const rejected = assert.rejects(pending, /OBSERVER_DEADLINE/);
    // request() first crosses readiness; advance the injected clock after its continuation.
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(timers.size, 1);
    timers.fire();
    await rejected;
    assert.equal(timers.size, 0);
    await assert.rejects(observer.request(command), /OBSERVER_DEADLINE/);
  } finally {
    await observer.stop();
  }
});

test("concurrent calls fail busy without killing the admitted request", async () => {
  const observer = fixture("send({version:1,done:true});");
  try {
    await observer.ready();
    const admitted = observer.request(command);
    const concurrent = observer.request(command);
    await assert.rejects(concurrent, /OBSERVER_BUSY/);
    assert.equal((await admitted).done, true);
  } finally {
    await observer.stop();
  }
});

for (const [name, output, error] of [
  ["malformed JSON", "process.stdout.write('oops\\n');", "OBSERVER_INVALID_FRAME"],
  ["binary UTF-8", "process.stdout.write(Buffer.from([255,10]));", "OBSERVER_INVALID_FRAME"],
  ["response suffix", "process.stdout.write('{\"version\":1}\\nextra');", "OBSERVER_INVALID_FRAME"],
  ["oversize output", "process.stdout.write('x'.repeat(65538));", "OBSERVER_OUTPUT_LIMIT"],
  ["stderr", "process.stderr.write('private sentinel');", "OBSERVER_STDERR"],
  ["unexpected protocol", "send({version:2});", "OBSERVER_UNEXPECTED_RESPONSE"],
  ["missing correlation", "process.stdout.write('{\"version\":1}\\n');", "OBSERVER_UNEXPECTED_RESPONSE"],
  [
    "foreign correlation",
    "process.stdout.write(JSON.stringify({requestID:'foreign',result:{version:1}})+'\\n');",
    "OBSERVER_UNEXPECTED_RESPONSE",
  ],
  ["array result", "send([]);", "OBSERVER_UNEXPECTED_RESPONSE"],
  ["null result", "send(null);", "OBSERVER_UNEXPECTED_RESPONSE"],
] as const) {
  test(`refuses ${name} with a sanitized terminal error`, async () => {
    const observer = fixture(output);
    try {
      await assert.rejects(observer.request(command), (e: unknown) => e instanceof Error && e.message === error);
    } finally {
      await observer.stop();
    }
  });
}

test("invalid hello cannot enable commands", async () => {
  const observer = fixture(hello, 'process.stdout.write(\'{"version":1,"ready":true,"extra":1}\\n\');');
  try {
    await assert.rejects(observer.ready(), /OBSERVER_INVALID_HELLO/);
  } finally {
    await observer.stop();
  }
});

test("injected initialization deadline rejects readiness and closes the child", async () => {
  const timers = manualClock();
  const observer = fixture("", "", timers);
  try {
    const rejected = assert.rejects(observer.ready(), /OBSERVER_DEADLINE/);
    timers.fire();
    await rejected;
    assert.equal(timers.size, 0);
  } finally {
    await observer.stop();
  }
});

test("a partial response followed by exit is not a successful result", async () => {
  const observer = fixture("process.stdout.end('{\"version\":1',()=>process.exitCode=0);process.stdin.destroy();");
  try {
    await assert.rejects(observer.request(command), /OBSERVER_EXITED/);
  } finally {
    await observer.stop();
  }
});

test("hello with a buffered suffix never reaches readiness", async () => {
  const observer = fixture("", 'process.stdout.write(\'{"version":1,"ready":true}\\nextra\');');
  try {
    await assert.rejects(observer.ready(), /OBSERVER_INVALID_FRAME/);
  } finally {
    await observer.stop();
  }
});

test("fragmented responses are reassembled before validation", async () => {
  const observer = fixture(
    "const wire=JSON.stringify({requestID:frame.requestID,result:{version:1,done:true}})+'\\n';process.stdout.write(wire.slice(0,10));setImmediate(()=>process.stdout.write(wire.slice(10)));",
  );
  try {
    assert.equal((await observer.request(command)).done, true);
  } finally {
    await observer.stop();
  }
});

test("spawn failure is sanitized and stop still completes", async () => {
  const observer = new OwnedObserver({ executable: "/nonexistent-observer", home: os.tmpdir() });
  try {
    await assert.rejects(observer.ready(), /OBSERVER_SPAWN_FAILED/);
  } finally {
    await observer.stop();
  }
});

test("a delayed old response cannot satisfy a newly admitted request", async () => {
  const script = `import readline from 'node:readline';
let n=0,old;
readline.createInterface({input:process.stdin}).on('line',line=>{
  if(n++===0){${hello}return;}
  const frame=JSON.parse(line);
  const result={version:1,marker:'old'};
  if(n===2){old=frame.requestID?{requestID:frame.requestID,result}:result;}
  process.stdout.write(JSON.stringify(old)+'\\n');
});`;
  const observer = new OwnedObserver({
    executable: process.execPath,
    home: os.tmpdir(),
    args: ["--input-type=module", "-e", script],
  });
  try {
    assert.equal((await observer.request(command)).marker, "old");
    await assert.rejects(observer.request(command), /OBSERVER_UNEXPECTED_RESPONSE/);
  } finally {
    await observer.stop();
  }
});

test("oversize input is not delivered and leaves the observer usable", async () => {
  const observer = fixture("send({version:1,done:true});");
  try {
    await assert.rejects(
      observer.request({ ...command, op: "observeSelected", handle: "x".repeat(8192) }),
      /OBSERVER_INPUT_LIMIT/,
    );
    assert.equal((await observer.request(command)).done, true);
  } finally {
    await observer.stop();
  }
});
