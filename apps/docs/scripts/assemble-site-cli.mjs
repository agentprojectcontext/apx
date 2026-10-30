import { resolve } from "node:path";
import { assembleSite } from "./assemble-site.mjs";

const [v1, v2, out] = process.argv.slice(2);
if (!v1 || !v2 || !out) throw new Error("Usage: assemble-site-cli.mjs <v1-dist> <v2-dist> <new-output-directory>");
await assembleSite({ v1: resolve(v1), v2: resolve(v2), out: resolve(out) });
