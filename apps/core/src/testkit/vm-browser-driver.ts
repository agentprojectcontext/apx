import fs from "node:fs";
import path from "node:path";
import { waitFor } from "./platform.ts";

/** A local CDP pipe stands in for the guest transport; its first successful expression can be held in transit. */
export function vmBrowserDriver(dir: string, chrome: string, gate: string) {
  const pids = path.join(dir, "browser-pids");
  const binary = path.join(dir, "guest-driver.mjs");
  fs.writeFileSync(
    binary,
    `#!${process.execPath}
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
if (process.argv.includes('/usr/local/bin/apx-browser')) {
  const child = spawn(${JSON.stringify(chrome)}, ['--headless=new', '--disable-gpu', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check', ...${JSON.stringify(process.getuid?.() === 0 ? ["--no-sandbox"] : [])}, '--user-data-dir=' + ${JSON.stringify(path.join(dir, "profile"))}, 'about:blank'], {stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']});
  fs.writeFileSync(${JSON.stringify(pids)}, [process.pid, child.pid].join('\\n'));
  const held = new Set();
  let used = false;
  function frames(stream, receive) {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    stream.on('data', chunk => {
      pending += decoder.write(chunk);
      let end;
      while ((end = pending.indexOf('\\0')) >= 0) {
        const raw = pending.slice(0, end);
        pending = pending.slice(end + 1);
        receive(JSON.parse(raw), raw + '\\0');
      }
    });
  }
  frames(process.stdin, (frame, raw) => {
    if (!used && frame.method === 'Runtime.callFunctionOn' && frame.params?.functionDeclaration?.includes('\\n42\\n')) held.add(frame.id);
    child.stdio[3].write(raw);
  });
  frames(child.stdio[4], (frame, raw) => {
    if (!used && held.has(frame.id) && frame.result?.result?.value === '42') {
      used = true;
      fetch(${JSON.stringify(gate)}).then(reply => reply.text()).then(() => process.stdout.write(raw)).catch(() => child.kill());
    } else process.stdout.write(raw);
  });
  process.on('SIGTERM', () => child.kill());
  child.on('close', () => { process.stdin.destroy(); process.stdout.end(); });
  child.stdio[3].on('error', () => {});
}
`,
    { mode: 0o755 },
  );
  return {
    binary,
    async closed() {
      if (!fs.existsSync(pids)) return;
      const ids = fs.readFileSync(pids, "utf8").split("\n").map(Number);
      await waitFor(
        () =>
          ids.every((pid) => {
            try {
              process.kill(pid, 0);
              return false;
            } catch {
              return true;
            }
          }),
        "the guest transport and browser to exit",
      );
    },
  };
}
