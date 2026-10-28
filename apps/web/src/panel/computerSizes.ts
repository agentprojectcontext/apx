// What setting the computer up takes, in the sizes the core picked for this machine.

/** Memory and disk to tell the owner before the first start; nothing until the core has said its sizes. */
export const setupSizes = (r: { memory_gib: number; disk_gib: number } | undefined) =>
  // The disk adds room for the guest system beside the owner's chosen size.
  r && { memory: r.memory_gib, disk: r.disk_gib + 2 };
