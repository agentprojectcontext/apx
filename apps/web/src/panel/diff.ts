/** One line of a diff as shown: added, removed, unchanged, or a hunk's header; `n` is its line number. */
export type DiffRow = { kind: "add" | "del" | "ctx" | "hunk"; text: string; n?: number };

type Hunk = {
  header: string;
  oldStart: number;
  newStart: number;
  newCount: number;
  lines: Array<{ kind: "add" | "del" | "ctx"; text: string }>;
};

/** A unified patch's hunks; `binary` when git only said the files differ. */
function hunksOf(patch: string): { hunks: Hunk[]; binary: boolean } {
  const hunks: Hunk[] = [];
  let binary = false;
  let hunk: Hunk | undefined;
  for (const line of patch.split("\n")) {
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))?/.exec(line);
    if (head) {
      hunk = {
        header: line,
        oldStart: Number(head[1]),
        newStart: Number(head[2]),
        newCount: head[3] === undefined ? 1 : Number(head[3]),
        lines: [],
      };
      hunks.push(hunk);
    } else if (!hunk) {
      if (line.startsWith("Binary files")) binary = true;
    } else if (line.startsWith("+")) hunk.lines.push({ kind: "add", text: line.slice(1) });
    else if (line.startsWith("-")) hunk.lines.push({ kind: "del", text: line.slice(1) });
    else if (line.startsWith(" ")) hunk.lines.push({ kind: "ctx", text: line.slice(1) });
  }
  return { hunks, binary };
}

/** The patch's own lines: each hunk under its header, numbered on the side each line belongs to. */
export function patchRows(patch: string): { rows: DiffRow[]; binary: boolean } {
  const { hunks, binary } = hunksOf(patch);
  const rows: DiffRow[] = [];
  for (const h of hunks) {
    rows.push({ kind: "hunk", text: h.header });
    let oldN = h.oldStart;
    let newN = h.newStart;
    for (const l of h.lines) {
      if (l.kind === "del") rows.push({ ...l, n: oldN++ });
      else {
        rows.push({ ...l, n: newN++ });
        if (l.kind === "ctx") oldN++;
      }
    }
  }
  return { rows, binary };
}

/**
 * The whole file with the patch's changes marked in place: the file as it is now, with removed lines put back where
 * they were. Undefined when the file no longer matches the patch (it changed again since), so only the patch is shown.
 */
export function wholeFileRows(patch: string, text: string): DiffRow[] | undefined {
  const { hunks, binary } = hunksOf(patch);
  if (binary || !hunks.length) return undefined;
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  const rows: DiffRow[] = [];
  let next = 1;
  const upTo = (end: number) => {
    for (; next < end; next++) rows.push({ kind: "ctx", text: lines[next - 1] ?? "", n: next });
  };
  for (const h of hunks) {
    // A hunk that only removes names the line before the removal.
    const start = h.newCount === 0 ? h.newStart + 1 : h.newStart;
    if (start < next || start - 1 > lines.length) return undefined;
    upTo(start);
    let oldN = h.oldStart;
    for (const l of h.lines) {
      if (l.kind === "del") {
        rows.push({ ...l, n: oldN++ });
        continue;
      }
      if (lines[next - 1] !== l.text) return undefined;
      rows.push({ ...l, n: next++ });
      if (l.kind === "ctx") oldN++;
    }
  }
  upTo(lines.length + 1);
  return rows;
}
