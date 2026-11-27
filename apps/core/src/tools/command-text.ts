/** The command as the shell will mostly see it: quotes and escapes dropped, paths to programs reduced to names. */
export const normalize = (c: string) =>
  c
    .replace(/\\\n/g, " ")
    .replace(/["'\\]/g, "")
    .replace(/(^|[\s;&|(])\/(?:[\w.-]+\/)*([\w.-]+)/g, "$1$2");

// Only a leading, direct search with known switches and a static pattern and paths. Anything ambiguous stays visible
// to the legacy scan: in particular, a pipeline could feed what the search prints into a shell.
const LITERAL_SEARCH =
  /^((?:rg|grep|egrep|fgrep)(?:[ \t]+-[nFiHw]+)*[ \t]+(?:(?:-e|--regexp|--)[ \t]+)?)(?:'([^'\r\n]*)'|"([^"\\$`\r\n]*)")((?:[ \t]+(?!-)[\w./][\w./*?-]*)*[ \t]*)(?=$|&&|\|\||;)/;

/** Hide a search pattern from deletion scans, never from the command the tool executes. */
export function withoutSearchPattern(code: string, forced: (c: string) => boolean): string {
  const search = LITERAL_SEARCH.exec(code);
  if (!search || (search[2] ?? search[3] ?? "").startsWith("-")) return code;
  const tail = code.slice(search[0].length);
  // In a compound command, only remove the false target when the rest already independently requires approval.
  if (tail && !forced(tail)) return code;
  return `${search[1]}''${search[4]}${tail}`;
}
