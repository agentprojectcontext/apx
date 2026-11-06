// apx import hermes: show what a Hermes home folder becomes in APX, and with --yes import exactly that.
import path from "node:path";
import type { HermesItem } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

const USAGE = "usage: apx import hermes <folder, usually ~/.hermes> [--yes]";

const ACTION: Record<HermesItem["action"], string> = { add: "add", update: "update", skip: "skip" };
const WHY: Record<NonNullable<HermesItem["why"]>, string> = {
  same: "already in APX",
  taken: "APX has another with that name",
  removed: "you removed it in APX",
  secret: "a secret: give it in APX",
  off: "comes turned off",
  none: "APX has no place for it",
  invalid: "APX cannot take it as it is",
  refused: "APX refused it",
};

function print(items: HermesItem[]) {
  for (const i of items) {
    const why = [i.why ? WHY[i.why] : "", i.detail ?? ""].filter(Boolean).join(": ");
    console.log(
      `${ACTION[i.action].padEnd(7)} ${i.kind.padEnd(8)} ${i.profile.padEnd(10)} ${i.name.slice(0, 48).padEnd(48)} ${why}`,
    );
  }
}

export async function hermesImport(client: ApxClient, folder: string | undefined, o: { yes?: boolean | undefined }) {
  if (!folder) throw new Error(USAGE);
  const where = { path: path.resolve(folder) };
  if (!o.yes) {
    const { items } = await client.call("hermes.preview", where);
    print(items);
    const n = items.filter((i) => i.action !== "skip").length;
    console.log(
      n ? `\nNothing imported yet. Add --yes to import these ${n}.` : "\nNothing to import: it is all in APX.",
    );
    return;
  }
  const { items } = await client.call("hermes.import", where);
  print(items);
}
