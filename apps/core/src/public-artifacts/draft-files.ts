import fs from "node:fs";
import path from "node:path";
import { writeAtomic } from "../paths.ts";

type Copy = { bytes: number; sha256: string };
type Reference = { id: string; copy?: Copy };
const managed = /^[a-f0-9-]{36}-[a-f0-9]{64}\.json$/i;
const staged = /^\.[a-f0-9-]{36}-[a-f0-9]{64}\.json\.[a-f0-9]{12}\.tmp$/i;

export function publicationDraftFiles(home: string) {
  const dir = path.join(home, "public-artifact-drafts");
  const name = (id: string, copy: Copy) => `${id}-${copy.sha256}.json`;
  const directory = () => {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid public-copy snapshot directory");
  };
  return {
    read(id: string, copy: Copy) {
      directory();
      const file = path.join(dir, name(id, copy));
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size !== copy.bytes) throw new Error("Invalid public-copy snapshot file");
      return fs.readFileSync(file, "utf8");
    },
    write(id: string, copy: Copy & { json: string }) {
      directory();
      const file = path.join(dir, name(id, copy));
      const stat = fs.lstatSync(file, { throwIfNoEntry: false });
      if (stat?.isFile() && stat.size === copy.bytes) return false;
      writeAtomic(file, copy.json, 0o600);
      return true;
    },
    rollback(references: readonly Reference[]) {
      try {
        directory();
        const remove = [
          ...references.flatMap((draft) => (draft.copy ? [name(draft.id, draft.copy)] : [])),
          ...fs.readdirSync(dir).filter((file) => staged.test(file)),
        ];
        for (const file of remove) {
          try {
            fs.unlinkSync(path.join(dir, file));
          } catch {}
        }
      } catch {}
    },
    prune(references: readonly Reference[]) {
      const keep = new Set(references.flatMap((draft) => (draft.copy ? [name(draft.id, draft.copy)] : [])));
      try {
        directory();
        for (const file of fs.readdirSync(dir)) {
          if ((!managed.test(file) || keep.has(file)) && !staged.test(file)) continue;
          try {
            fs.unlinkSync(path.join(dir, file));
          } catch {}
        }
      } catch {}
    },
  };
}
