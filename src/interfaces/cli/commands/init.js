import path from "node:path";
import { initApf } from "#core/apc/scaffold.js";

export function cmdInit(args) {
  const dir = args._[0] || ".";
  const name = args.flags.name === true ? undefined : args.flags.name;
  const result = initApf(dir, { name });

  console.log(`Initialized APC project at ${result.root}`);
  console.log(`  ${path.relative(process.cwd(), result.agentsMd)}`);
  console.log(`  ${path.relative(process.cwd(), result.projectJson)}`);

  if (result.pendingMigration?.length > 0) {
    console.log(`\napx: existing context files detected:`);
    for (const { file, label } of result.pendingMigration) {
      console.log(`  ${file.padEnd(44)} ${label}`);
    }
    console.log(`\n  .apc/migrate.md written.`);
    console.log(`  Open this project in your AI assistant — it will offer to migrate.`);
  } else {
    console.log(`\nNext: apx agent add <slug> --role <role> --model <model>`);
  }
}
