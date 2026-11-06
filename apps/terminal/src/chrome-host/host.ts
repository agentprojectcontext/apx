// `apx chrome-host`: Chrome starts it when APX's extension connects, and it lives as long as that connection. It lends
// the extension's tabs to the local core as a node; when the core is down it keeps trying, so APX can start later.
import { CHROME_CAP, CHROME_EXTENSION_ORIGIN } from "@apx/protocol";
import type { ApxClient, ApxSocket } from "@apx/protocol/client";
import { createChromeTabs } from "./tabs.ts";
import { ExtensionLink, encodeFrame, frameReader } from "./wire.ts";

const RETRY_MS = 3_000;

export type HostIo = {
  input: NodeJS.ReadableStream;
  write(frame: Buffer): void;
};

/**
 * Serves until Chrome closes the connection. `origin` is the caller Chrome names: anything but APX's extension is
 * refused before a byte is read.
 */
export async function runChromeHost(opts: {
  origin: string | undefined;
  io: HostIo;
  client: ApxClient;
  /** The core's port: tabs never load APX itself. */
  corePort: string;
  selectAllModifiers?: number;
  retryMs?: number;
}): Promise<void> {
  if (opts.origin !== CHROME_EXTENSION_ORIGIN) throw new Error("apx chrome-host serves only APX's Chrome extension");
  const link = new ExtensionLink((frame) => opts.io.write(encodeFrame(frame)));
  const tabs = createChromeTabs({
    link,
    blockedPorts: new Set([opts.corePort]),
    selectAllModifiers: opts.selectAllModifiers ?? (process.platform === "darwin" ? 4 : 2),
  });
  let ended = false;
  let socket: ApxSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const end = () => {
    if (ended) return;
    ended = true;
    clearTimeout(retry);
    link.close("Chrome closed the connection");
    socket?.close();
    finish();
  };
  const connect = async () => {
    if (ended) return;
    try {
      const s = await opts.client.connect("node", [CHROME_CAP]);
      if (ended) return s.close();
      socket = s;
      s.onRequest((method, params) => tabs.handle(method, params));
      void s.closed.then(() => {
        socket = undefined;
        if (!ended) retry = setTimeout(() => void connect(), opts.retryMs ?? RETRY_MS);
      });
    } catch {
      if (!ended) retry = setTimeout(() => void connect(), opts.retryMs ?? RETRY_MS);
    }
  };
  const read = frameReader((message) => link.receive(message));
  const onData = (chunk: Buffer) => {
    try {
      read(chunk);
    } catch {
      end();
    }
  };
  opts.io.input.on("data", onData);
  opts.io.input.once("end", end);
  opts.io.input.once("error", end);
  void connect();
  try {
    await done;
  } finally {
    opts.io.input.off("data", onData);
  }
}
