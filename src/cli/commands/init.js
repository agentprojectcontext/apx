import path from "node:path";
import { initApf } from "../../core/scaffold.js";

export function cmdInit(args) {
  const dir = args._[0] || ".";
  const name = args.flags.name === true ? undefined : args.flags.name;
  const result = initApf(dir, { name });

  console.log(`Initialized APC project at ${result.root}`);
  console.log(`  ${path.relative(process.cwd(), result.agentsMd)}`);
  console.log(`  ${path.relative(process.cwd(), result.projectJson)}`);
  console.log(`\nNext: apx agent add <slug> --role <role> --model <model>`);
}
