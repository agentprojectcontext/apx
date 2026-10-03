// Where Node keeps the TypeScript it already stripped and the bytecode it compiled (NODE_COMPILE_CACHE). With it warm,
// a core starts without loading the TypeScript stripper at all: about 40 MB less resident memory, and a faster start.
// One per checkout, so it survives reboots; a changed file is keyed by its content and simply cached again.
import path from "node:path";

export function compileCacheEnv(root: string): { NODE_COMPILE_CACHE: string } {
  return { NODE_COMPILE_CACHE: process.env.NODE_COMPILE_CACHE ?? path.join(root, "node_modules/.cache/node-compile") };
}
