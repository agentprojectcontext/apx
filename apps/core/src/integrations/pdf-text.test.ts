import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { tempDir } from "../testkit/platform.ts";
import { pdfText } from "./pdf-text.ts";

const PDF = Buffer.from("%PDF-synthetic");
const childFor = (script: string, signal: AbortSignal) =>
  spawn(process.execPath, ["-e", script], {
    stdio: ["pipe", "pipe", "ignore"],
    signal,
    killSignal: "SIGKILL",
    windowsHide: true,
  });

function exited(pid: number | undefined) {
  assert.ok(pid);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}

test("PDF extraction waits for successful process closure and decodes UTF-8", async () => {
  let pid: number | undefined;
  const text = await pdfText(PDF, undefined, {
    start: (signal) => {
      const child = childFor(
        "process.stdin.resume(); process.stdin.on('end',()=>process.stdout.write('Acme\\fNorthwind\\f'))",
        signal,
      );
      pid = child.pid;
      return child;
    },
  });
  assert.equal(text, "Acme\fNorthwind\f");
  exited(pid);
});

test("PDF extraction kills and reaps a running child on caller cancellation or injected deadline", async () => {
  for (const mode of ["caller", "deadline"] as const) {
    const controller = new AbortController();
    let pid: number | undefined;
    await assert.rejects(
      pdfText(PDF, mode === "caller" ? controller.signal : undefined, {
        ...(mode === "deadline" ? { deadline: controller.signal } : {}),
        start: (signal) => {
          const child = childFor(
            "process.stdin.resume(); process.stdout.write('ready'); setInterval(()=>{},1000)",
            signal,
          );
          pid = child.pid;
          child.stdout.once("data", () => controller.abort());
          return child;
        },
      }),
      /could not finish/,
    );
    exited(pid);
  }
});

test("PDF extraction rejects excess output and reaps the child before returning", async () => {
  let pid: number | undefined;
  await assert.rejects(
    pdfText(PDF, undefined, {
      start: (signal) => {
        const child = childFor(
          "process.stdin.resume(); process.stdout.write('x'.repeat(4*1024*1024+1)); setInterval(()=>{},1000)",
          signal,
        );
        pid = child.pid;
        return child;
      },
    }),
    /exceeds the extraction limit/,
  );
  exited(pid);
});

test("PDF extraction returns generic errors for process failure, invalid UTF-8 and image-only output", async () => {
  for (const [script, expected] of [
    [
      "process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write('private outside text');process.exitCode=1;})",
      /encrypted or invalid PDF/,
    ],
    ["process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(Buffer.from([255])))", /invalid UTF-8/],
    ["process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(' \\f'))", /no extractable text/],
  ] as const) {
    let pid: number | undefined;
    await assert.rejects(
      pdfText(PDF, undefined, {
        start: (signal) => {
          const child = childFor(script, signal);
          pid = child.pid;
          return child;
        },
      }),
      expected,
    );
    exited(pid);
  }
});

test("a missing extractor explains the optional dependency without returning input content", async () => {
  const folder = tempDir();
  try {
    await assert.rejects(
      pdfText(PDF, undefined, {
        start: (signal) =>
          spawn(path.join(folder.path, "missing-extractor"), [], { stdio: ["pipe", "pipe", "ignore"], signal }),
      }),
      /Poppler's pdftotext installed/,
    );
  } finally {
    await folder.remove();
  }
});
