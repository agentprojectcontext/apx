// What the panel shows for the disk holding APX, from `storage.status` and whether the owner closed the warning:
// the card (strip on a phone) while low and not closed, the disk mark in the sidebar once closed, nothing with room.
import type { DiskStatus } from "@apx/protocol";

export type DiskWarning = "card" | "mark" | undefined;

export function diskWarning(disk: DiskStatus | undefined, closed: boolean): DiskWarning {
  if (!disk?.low) return undefined;
  return closed ? "mark" : "card";
}
