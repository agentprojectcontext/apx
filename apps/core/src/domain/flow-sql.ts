// What a SQL step's statement is, read without running it: its first keyword, how many statements it holds and the
// parameters it names. Strings, quoted names and comments are skipped, so a word inside them never counts.

export type FlowSqlShape = {
  /** The first keyword, upper case ("" when there is none). */
  first: string;
  statements: number;
  /** `:name`, `@name` and `$name` parameters, each once. */
  names: string[];
  /** `?` or `?1` parameters (a step names its values instead). */
  positional: boolean;
};

/** Statements a read may be; a write may also change rows or add a table or an index. */
export const SQL_READS = new Set(["SELECT", "WITH", "VALUES"]);
export const SQL_WRITES = new Set([...SQL_READS, "INSERT", "UPDATE", "DELETE", "REPLACE", "CREATE"]);

export function flowSqlShape(q: string): FlowSqlShape {
  let first = "";
  let statements = 0;
  let open = false;
  let positional = false;
  const names = new Set<string>();
  for (let i = 0; i < q.length; ) {
    const c = q[i] ?? "";
    const two = q.slice(i, i + 2);
    if (two === "--") {
      const end = q.indexOf("\n", i);
      i = end < 0 ? q.length : end + 1;
      continue;
    }
    if (two === "/*") {
      const end = q.indexOf("*/", i + 2);
      i = end < 0 ? q.length : end + 2;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === ";") {
      open = false;
      i++;
      continue;
    }
    if (!open) {
      open = true;
      statements++;
    }
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      for (; j < q.length; j++) {
        if (q[j] !== close) continue;
        // A doubled quote is the quote itself.
        if (close !== "]" && q[j + 1] === close) j++;
        else break;
      }
      i = j + 1;
      continue;
    }
    const param = /^([:@$])([A-Za-z_][A-Za-z0-9_]*)/.exec(q.slice(i));
    if (param?.[2]) {
      names.add(param[2]);
      i += param[0].length;
      continue;
    }
    if (c === "?") {
      positional = true;
      i++;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(q.slice(i));
    if (word) {
      if (statements === 1 && !first) first = word[0].toUpperCase();
      i += word[0].length;
      continue;
    }
    i++;
  }
  return { first, statements, names: [...names], positional };
}
