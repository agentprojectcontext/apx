// Compare declarations, not just PRAGMAs: an absent foreign key passes foreign_key_check.
function tokens(sql: string | null): string[] {
  return (
    sql?.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|\s+|[\w$]+|./gs) ?? []
  )
    .filter((token) => !/^\s+$/.test(token) && !token.startsWith("--") && !token.startsWith("/*") && token !== ";")
    .map((token) => (/^[\w$]+$/.test(token) ? token.toLowerCase() : token));
}

export function sameSchemaSql(left: string | null, right: string | null): boolean {
  return JSON.stringify(tokens(left)) === JSON.stringify(tokens(right));
}

function identifier(token: string | undefined): string {
  if (!token) return "";
  if (token.startsWith('"')) return token.slice(1, -1).replaceAll('""', '"').toLowerCase();
  if (token.startsWith("`")) return token.slice(1, -1).replaceAll("``", "`").toLowerCase();
  if (token.startsWith("[")) return token.slice(1, -1).toLowerCase();
  return token;
}

function table(sql: string | null, allowed: readonly string[]) {
  const parts = tokens(sql);
  const open = parts.indexOf("(");
  if (open < 0) return undefined;
  const declarations: string[][] = [[]];
  let depth = 1;
  let close = -1;
  for (let i = open + 1; i < parts.length; i++) {
    const token = parts[i];
    if (token === "(") depth++;
    if (token === ")") depth--;
    if (depth === 0) {
      close = i;
      break;
    }
    if (token === "," && depth === 1) declarations.push([]);
    else if (token !== undefined) declarations[declarations.length - 1]?.push(token);
  }
  if (close < 0) return undefined;
  const columns = new Map<string, string>();
  const base: string[][] = [];
  for (const declaration of declarations) {
    const name = identifier(declaration[0]);
    if (!name) return undefined;
    if (allowed.includes(name)) {
      if (columns.has(name)) return undefined;
      columns.set(name, JSON.stringify(declaration.slice(1)));
    } else base.push(declaration);
  }
  return { shape: JSON.stringify([parts.slice(0, open), base, parts.slice(close)]), columns };
}

/** Only recognized added columns may differ from the complete canonical table declaration. */
export function compatibleMigrationTable(
  actual: string | null,
  baseline: string | null,
  final: string | null,
  allowedColumns: readonly string[],
): boolean {
  if (!allowedColumns.length) return sameSchemaSql(actual, baseline);
  const found = table(actual, allowedColumns);
  const expected = table(final, allowedColumns);
  const base = table(baseline, allowedColumns);
  if (!found || !expected || !base || found.shape !== base.shape) return false;
  return [...found.columns].every(([name, declaration]) => expected.columns.get(name) === declaration);
}
