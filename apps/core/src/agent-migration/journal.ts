import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { FileJournal } from "../domain/agent-migration-file-journal.ts";
import { migrationFilePath } from "../domain/agent-migration-files.ts";
import { badRequest } from "../errors.ts";
import { writeAtomic } from "../paths.ts";

const Name = z.enum(["work", "artifacts", "artifact-sources"]);
const Record = z.object({
  id: z.string().uuid(),
  agent: z.string(),
  source: z.string(),
  destination: z.string(),
  source_root: z.string(),
  destination_root: z.string(),
  threads: z.array(z.string()),
  journals: z.array(Name),
  state: z.enum(["applying", "committed", "recovering", "restored"]),
});
export type MoveRecord = z.infer<typeof Record>;
export const recoveryRoot = (home: string) => path.join(home, "agent-moves");
export const recoveryFolder = (home: string, id: string) =>
  migrationFilePath(recoveryRoot(home), z.string().uuid().parse(id));
export function writeMoveRecord(home: string, value: MoveRecord) {
  const record = Record.parse(value);
  const folder = recoveryFolder(home, record.id);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeAtomic(path.join(folder, "move.json"), JSON.stringify(record), 0o600);
}
export function readMoveRecord(home: string, id: string): MoveRecord {
  const record = Record.parse(
    JSON.parse(fs.readFileSync(migrationFilePath(recoveryFolder(home, id), "move.json"), "utf8")),
  );
  if (record.id !== id) throw badRequest("This recovery journal belongs to another move");
  return record;
}
const FileRecord = z.object({
  id: z.string(),
  source: z.string(),
  destination: z.string(),
  state: z.enum(["prepared", "applied", "committed", "recovering", "recovered"]),
  changes: z.array(
    z.object({
      root: z.enum(["source", "destination"]),
      relative: z.string(),
      before: z.string().nullable(),
      after: z.string().nullable(),
      mode: z.number().int(),
    }),
  ),
});
export function readMoveJournals(home: string, record: MoveRecord): Array<{ folder: string; journal: FileJournal }> {
  return record.journals.map((name) => {
    const folder = migrationFilePath(recoveryFolder(home, record.id), Name.parse(name));
    const journal = FileRecord.parse(JSON.parse(fs.readFileSync(migrationFilePath(folder, "journal.json"), "utf8")));
    if (journal.id !== record.id) throw badRequest("This file journal belongs to another move");
    return { folder, journal };
  });
}
