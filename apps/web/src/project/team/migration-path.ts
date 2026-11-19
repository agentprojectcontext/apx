// File tree entries retain the core's spelling; compare their segments, not a textual directory prefix.
function segments(value: string): string[] {
  const result: string[] = [];
  const windows = /^[a-z]:[/\\]/i.test(value) || /^\\\\/.test(value);
  for (const part of value.split(/[/\\]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") result.pop();
    else result.push(windows ? part.toLowerCase() : part);
  }
  return result;
}
export function isInside(root: string, file: string): boolean {
  const base = segments(root);
  const target = segments(file);
  return base.length <= target.length && base.every((part, index) => part === target[index]);
}
export function samePath(left: string, right: string): boolean {
  return isInside(left, right) && isInside(right, left);
}
