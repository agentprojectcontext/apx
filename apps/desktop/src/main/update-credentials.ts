import fs from "node:fs";
import path from "node:path";

export function updateCredentials(
  directory: string,
  encryption: {
    available(): boolean;
    encrypt(value: string): Buffer;
    decrypt(value: Buffer): string;
  },
) {
  const file = path.join(directory, "update-credentials.json");
  return {
    read(identity: string): string | undefined {
      if (!encryption.available()) return undefined;
      try {
        const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { identity: string; encrypted: string };
        if (saved.identity === identity) return encryption.decrypt(Buffer.from(saved.encrypted, "base64"));
      } catch {}
      return undefined;
    },
    write(identity: string, token: string | undefined): void {
      try {
        if (!token || !encryption.available()) {
          fs.rmSync(file, { force: true });
          return;
        }
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(
          `${file}.tmp`,
          JSON.stringify({ identity, encrypted: encryption.encrypt(token).toString("base64") }),
          { mode: 0o600 },
        );
        fs.renameSync(`${file}.tmp`, file);
      } catch {
        // Authentication still works in memory when OS-backed storage is unavailable.
      }
    },
  };
}
