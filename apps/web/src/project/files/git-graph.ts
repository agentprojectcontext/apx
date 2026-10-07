// The history's graph: which column each commit sits in and which lines cross its row, from commits listed children
// before parents (git log --topo-order). Columns are reused once a line ends, so the graph stays narrow.

export type GraphRow = {
  /** The commit's column. */
  col: number;
  /** Columns whose line passes this row untouched, top to bottom. */
  through: number[];
  /** Columns whose line comes down into this commit (its children's lines). */
  into: number[];
  /** Columns this commit's lines go down to (its parents'). */
  out: number[];
  /** How many columns are in use at this row, to size it. */
  width: number;
};

/** Lays commits (newest first, each before its parents) out in columns. */
export function graphRows(commits: ReadonlyArray<{ sha: string; parents: readonly string[] }>): GraphRow[] {
  // What each column waits for: the sha its line leads to next, or null when it is free.
  const lanes: Array<string | null> = [];
  const free = () => {
    const i = lanes.indexOf(null);
    return i < 0 ? lanes.length : i;
  };
  return commits.map(({ sha, parents }) => {
    const into = lanes.flatMap((l, i) => (l === sha ? [i] : []));
    const col = into[0] ?? free();
    const before = [...lanes];
    // The lines that came here end here; the commit's own column carries on to its first parent.
    for (const i of into) lanes[i] = null;
    lanes[col] = parents[0] ?? null;
    const out: number[] = parents[0] ? [col] : [];
    for (const p of parents.slice(1)) {
      const already = lanes.indexOf(p);
      if (already >= 0) out.push(already);
      else {
        const at = free();
        lanes[at] = p;
        out.push(at);
      }
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    const through = before.flatMap((l, i) => (l !== null && l !== sha && lanes[i] === l ? [i] : []));
    return { col, through, into, out, width: Math.max(before.length, lanes.length, col + 1) };
  });
}
