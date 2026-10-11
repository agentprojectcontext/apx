// ssh asks for a password, a passphrase or a host-key answer through SSH_ASKPASS. That program is this app's own
// executable in askpass mode: it hands the question to the running app over a local socket made for one login, prints
// the owner's answer for ssh and exits. No Electron here, so the round trip is tested on plain Node.
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

export type Prompt = { text: string; secret: boolean };

/** One question from ssh. `undefined` = the owner cancelled (or left): ssh gets no answer. */
export type Ask = (prompt: Prompt) => Promise<string | undefined>;

export type Askpass = {
  /** What ssh's environment needs so its questions come here. */
  env: Record<string, string>;
  close(): void;
};

const MAX_FRAME = 16 * 1024;

/** A yes/no question (the host key) shows what is typed; anything else (password, passphrase, PIN) is masked. */
export function classifyPrompt(raw: string): Prompt {
  const text = stripVTControlCharacters(raw)
    .replace(/[^\S\n]*\r?\n/g, "\n")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this strips
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
    .slice(0, 2000);
  return { text, secret: !/\byes\/no\b/i.test(text) };
}

/**
 * Listens for this login's questions. `exe` is the program ssh runs (the app's executable); `appDir` is set from a
 * checkout, where that executable is Electron and needs the app's folder, so a small wrapper script names both.
 */
export async function openAskpass(opts: { ask: Ask; exe: string; appDir?: string | undefined }): Promise<Askpass> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-askpass-"));
  const endpoint =
    process.platform === "win32" ? `\\\\.\\pipe\\apx-askpass-${randomBytes(12).toString("hex")}` : path.join(dir, "s");
  const key = randomBytes(24).toString("hex");
  const server = net.createServer((socket) => serve(socket, key, opts.ask));
  server.maxConnections = 1;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(endpoint, () => resolve());
  });
  const program = opts.appDir ? wrapper(dir, opts.exe, opts.appDir) : opts.exe;
  return {
    env: {
      SSH_ASKPASS: program,
      SSH_ASKPASS_REQUIRE: "force",
      APX_ASKPASS: endpoint,
      APX_ASKPASS_KEY: key,
      // Older Linux builds only use SSH_ASKPASS when a display is named, even when forced.
      ...(process.platform === "linux" && !process.env.DISPLAY ? { DISPLAY: ":0" } : {}),
    },
    close() {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function serve(socket: net.Socket, key: string, ask: Ask): void {
  let buf = "";
  let done = false;
  socket.setEncoding("utf8");
  socket.on("error", () => socket.destroy());
  socket.on("data", (chunk: string) => {
    if (done) return;
    buf += chunk;
    if (buf.length > MAX_FRAME) return void socket.destroy();
    const nl = buf.indexOf("\n");
    if (nl < 0) return;
    done = true;
    let frame: { key?: unknown; prompt?: unknown };
    try {
      frame = JSON.parse(buf.slice(0, nl));
    } catch {
      return void socket.destroy();
    }
    if (!sameKey(frame.key, key) || typeof frame.prompt !== "string") return void socket.destroy();
    ask(classifyPrompt(frame.prompt)).then(
      (answer) => socket.end(`${JSON.stringify(answer === undefined ? { cancel: true } : { answer })}\n`),
      () => socket.end(`${JSON.stringify({ cancel: true })}\n`),
    );
  });
}

function sameKey(given: unknown, key: string): boolean {
  if (typeof given !== "string" || given.length !== key.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

/** The app's side of one question: sends it to the running app and waits for the owner's answer. */
export function requestAnswer(endpoint: string, key: string, prompt: string, timeoutMs = 10 * 60_000) {
  return new Promise<string | undefined>((resolve) => {
    const socket = net.connect(endpoint);
    let buf = "";
    const timer = setTimeout(() => socket.destroy(), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ key, prompt })}\n`));
    socket.on("data", (chunk: string) => {
      buf += chunk;
      if (buf.length > MAX_FRAME) socket.destroy();
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(timer);
      try {
        const reply = JSON.parse(buf.split("\n")[0] ?? "") as { answer?: unknown };
        resolve(typeof reply.answer === "string" ? reply.answer : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

/**
 * Askpass mode (the executable started by ssh with APX_ASKPASS set): the question is the last argument, the answer
 * goes to stdout. Exit code 1 tells ssh there is none.
 */
export async function runAskpass(
  env: NodeJS.ProcessEnv,
  argv: string[],
  out: NodeJS.WritableStream = process.stdout,
): Promise<number> {
  const endpoint = env.APX_ASKPASS;
  const key = env.APX_ASKPASS_KEY;
  if (!endpoint || !key) return 1;
  const answer = await requestAnswer(endpoint, key, argv.length > 1 ? (argv.at(-1) ?? "") : "");
  if (answer === undefined) return 1;
  await new Promise<void>((resolve) => out.write(`${answer}\n`, () => resolve()));
  return 0;
}

/** A checkout's ssh cannot pass Electron the app's folder: a script in the login's private folder does. */
function wrapper(dir: string, exe: string, appDir: string): string {
  if (process.platform === "win32") {
    const file = path.join(dir, "askpass.cmd");
    fs.writeFileSync(file, `@"${exe}" "${appDir}" %*\r\n`);
    return file;
  }
  const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
  const file = path.join(dir, "askpass.sh");
  fs.writeFileSync(file, `#!/bin/sh\nexec ${quote(exe)} ${quote(appDir)} "$@"\n`, { mode: 0o700 });
  return file;
}
