// A line-and-bytes reader over a TCP or TLS socket, for the mail protocols (IMAP, SMTP). Every read has a deadline;
// STARTTLS upgrades the same connection in place.
import net from "node:net";
import tls from "node:tls";

export type MailTls = "implicit" | "starttls" | "none";
export type Endpoint = { host: string; port: number; tls: MailTls };

/** No answer within the deadline (the connection is still usable for IMAP's IDLE). */
export class MailTimeout extends Error {
  constructor(what: string) {
    super(`${what}: no answer in time`);
    this.name = "MailTimeout";
  }
}

/** Plain text on the wire is accepted only to this machine (a local bridge or a test server). */
export const isLoopback = (host: string) => /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\])$/i.test(host);

const MAX_LINE = 64 * 1024;

export class MailSocket {
  private sock: net.Socket;
  private buf: Buffer = Buffer.alloc(0);
  private wake: (() => void) | undefined;
  private failed: Error | undefined;
  private readonly host: string;

  private constructor(sock: net.Socket, host: string) {
    this.sock = sock;
    this.host = host;
    this.attach(sock);
  }

  /** Connects (TLS from the first byte for `implicit`), within `ms`. */
  static open(ep: Endpoint, ms: number, signal: AbortSignal): Promise<MailSocket> {
    return new Promise((resolve, reject) => {
      const opts = { host: ep.host, port: ep.port };
      const sock =
        ep.tls === "implicit"
          ? tls.connect({ ...opts, ...(net.isIP(ep.host) ? {} : { servername: ep.host }) })
          : net.connect(opts);
      const timer = setTimeout(() => fail(new MailTimeout(`connecting to ${ep.host}:${ep.port}`)), ms);
      const onAbort = () => fail(new Error("stopped"));
      signal.addEventListener("abort", onAbort, { once: true });
      function fail(err: Error) {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        sock.destroy();
        reject(err);
      }
      sock.once("error", fail);
      sock.once(ep.tls === "implicit" ? "secureConnect" : "connect", () => {
        clearTimeout(timer);
        sock.off("error", fail);
        signal.removeEventListener("abort", onAbort);
        const s = new MailSocket(sock, ep.host);
        const stop = () => s.close();
        signal.addEventListener("abort", stop, { once: true });
        sock.once("close", () => signal.removeEventListener("abort", stop));
        resolve(s);
      });
    });
  }

  private attach(sock: net.Socket): void {
    sock.on("data", (d: Buffer) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
      this.wake?.();
    });
    sock.on("error", (err) => {
      this.failed ??= err;
      this.wake?.();
    });
    sock.on("close", () => {
      this.failed ??= new Error("the mail server closed the connection");
      this.wake?.();
    });
  }

  /** STARTTLS: the same connection, encrypted from here on; the certificate must match the host. */
  upgrade(ms: number): Promise<void> {
    const plain = this.sock;
    plain.removeAllListeners("data");
    plain.removeAllListeners("close");
    return new Promise((resolve, reject) => {
      const secure = tls.connect({ socket: plain, ...(net.isIP(this.host) ? {} : { servername: this.host }) });
      const timer = setTimeout(() => {
        secure.destroy();
        reject(new MailTimeout("starting TLS"));
      }, ms);
      secure.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      secure.once("secureConnect", () => {
        clearTimeout(timer);
        this.sock = secure;
        this.buf = Buffer.alloc(0);
        this.attach(secure);
        resolve();
      });
    });
  }

  private async more(ms: number, what: string): Promise<void> {
    if (this.failed) throw this.failed;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.wake = undefined;
        reject(new MailTimeout(what));
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
    });
  }

  /** The next line, without its CRLF. */
  async line(ms: number, what = "reading"): Promise<string> {
    const end = Date.now() + ms;
    for (;;) {
      const nl = this.buf.indexOf("\n");
      if (nl >= 0) {
        const line = this.buf.subarray(0, nl).toString("utf8").replace(/\r$/, "");
        this.buf = this.buf.subarray(nl + 1);
        return line;
      }
      if (this.buf.length > MAX_LINE) throw new Error("the mail server sent a line that is too long");
      await this.more(Math.max(1, end - Date.now()), what);
    }
  }

  /** Exactly `n` bytes (an IMAP literal). */
  async bytes(n: number, ms: number): Promise<Buffer> {
    const end = Date.now() + ms;
    while (this.buf.length < n) await this.more(Math.max(1, end - Date.now()), "reading a message");
    const out = Buffer.from(this.buf.subarray(0, n));
    this.buf = this.buf.subarray(n);
    return out;
  }

  write(data: string | Buffer): Promise<void> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => this.sock.write(data, (err) => (err ? reject(err) : resolve())));
  }

  close(): void {
    this.failed ??= new Error("closed");
    this.sock.destroy();
    this.wake?.();
  }
}
