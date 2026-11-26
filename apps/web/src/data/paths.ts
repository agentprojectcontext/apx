// Paths as the core spells them: compare their segments, not a textual directory prefix.

/** The path's segments as written, with "." and ".." applied. */
function parts(value: string): string[] {
  const result: string[] = [];
  for (const part of value.split(/[/\\]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") result.pop();
    else result.push(part);
  }
  return result;
}

/** Segments to compare: a Windows path's case does not tell two files apart. */
function segments(value: string): string[] {
  const windows = /^[a-z]:[/\\]/i.test(value) || /^\\\\/.test(value);
  return windows ? parts(value).map((part) => part.toLowerCase()) : parts(value);
}

export function isInside(root: string, file: string): boolean {
  const base = segments(root);
  const target = segments(file);
  return base.length <= target.length && base.every((part, index) => part === target[index]);
}

export function samePath(left: string, right: string): boolean {
  return isInside(left, right) && isInside(right, left);
}

/** `file` as a path under `root` ("a/b.md", "" for the root itself), or undefined when it is not inside. */
export function relativeInside(root: string, file: string): string | undefined {
  return isInside(root, file) ? parts(file).slice(parts(root).length).join("/") : undefined;
}
