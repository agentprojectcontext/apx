// Which invocations of APX's own CLI only read: anything else it does may act as the owner (DECISIONS.md#d-197).
import type { Word } from "./command-paths.ts";

/** Each command that reads, and the subcommands under it that only list or show (undefined: the command alone). */
const APX_READS: Record<string, readonly (string | undefined)[]> = {
  status: [undefined],
  version: [undefined],
  help: [undefined],
  threads: [undefined, "list", "search", "get"],
  runs: ["pending", "get", "wait"],
  tasks: [undefined, "show", "commitments", "help"],
  routines: [undefined, "show", "log", "help"],
  agents: [undefined, "list"],
};
/** Options that change nothing; the ones that take a value consume the next word unless written `--x=v`. */
const FLAGS = /^(--json|--plain|--status|--version|-v|--help|-h)$/;
/** Options that are a reading command by themselves (`apx --version`). */
const ALONE = /^(--status|--version|-v|--help|-h)$/;
const VALUED = /^--(project|agent)(=.*)?$/;

/** A CLI command line's arguments (after `apx`) that only read: known options, then a reading command. */
export function apxReads(args: Word[]): boolean {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const w = args[i] as Word;
    if (w.unknown || w.brace) return false;
    if (FLAGS.test(w.text)) continue;
    const valued = VALUED.exec(w.text);
    if (valued) {
      if (!valued[2]) i++;
      continue;
    }
    if (w.text.startsWith("-")) return false;
    positional.push(w.text);
  }
  const [command, sub] = positional;
  if (command === undefined) return args.some((a) => ALONE.test(a.text));
  return Object.hasOwn(APX_READS, command) && (APX_READS[command] ?? []).includes(sub);
}

/** Whether `node <path>` runs APX's CLI from a checkout. */
export const apxEntry = (path: string) => /(^|\/)apps\/terminal\/src\/main\.ts$/.test(path);
