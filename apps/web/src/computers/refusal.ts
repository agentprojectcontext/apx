import type { ComputerMemoryRefusal } from "@apx/protocol";
import { ApxError } from "@apx/protocol/client";

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The numbers of a start the core refused for want of free memory, said in the panel's language; else undefined. */
export function memoryRefusal(failure: unknown): ComputerMemoryRefusal | undefined {
  const d = failure instanceof ApxError ? (failure.detail as Record<string, unknown> | undefined) : undefined;
  if (!d || typeof d !== "object" || d.reason !== "memory") return undefined;
  if (!num(d.free_gib) || !num(d.vm_gib) || !num(d.reserve_gib)) return undefined;
  return {
    reason: "memory",
    free_gib: d.free_gib,
    vm_gib: d.vm_gib,
    reserve_gib: d.reserve_gib,
    ...(num(d.fits_gib) ? { fits_gib: d.fits_gib } : {}),
    ...(d.anyway === true ? { anyway: true } : {}),
  };
}
