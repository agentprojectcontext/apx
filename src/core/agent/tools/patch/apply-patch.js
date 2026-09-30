// The `apply_patch` format GPT/Codex models are trained to write:
//
//   *** Begin Patch
//   *** Add File: path/new.js
//   +line
//   *** Update File: path/old.js
//   *** Move to: path/renamed.js      (optional)
//   @@ optional anchor line
//    context
//   -removed
//   +added
//   *** Delete File: path/gone.js
//   *** End Patch
//
// Pure: parse the text, compute every file's new content, and hand back the
// change set. Nothing touches disk here, so a patch whose third hunk does not
// apply leaves the first two files as they were (the handler writes all or
// nothing).

const BEGIN = "*** Begin Patch";
const END = "*** End Patch";
const ADD = "*** Add File: ";
const UPDATE = "*** Update File: ";
const DELETE = "*** Delete File: ";
const MOVE = "*** Move to: ";
const EOF_MARK = "*** End of File";

export class PatchError extends Error {}

/** Parse patch text into [{type:"add"|"update"|"delete", path, moveTo?, lines?, chunks?}]. */
export function parsePatch(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  let i = lines.findIndex((l) => l.trim() === BEGIN);
  if (i < 0) throw new PatchError(`patch must start with "${BEGIN}"`);
  i++;
  const ops = [];
  while (i < lines.length && lines[i].trim() !== END) {
    const line = lines[i];
    if (line.startsWith(ADD)) {
      const op = { type: "add", path: line.slice(ADD.length).trim(), lines: [] };
      i++;
      while (i < lines.length && !lines[i].startsWith("*** ")) {
        if (!lines[i].startsWith("+")) throw new PatchError(`Add File ${op.path}: every line must start with "+" (got "${lines[i].slice(0, 40)}")`);
        op.lines.push(lines[i].slice(1));
        i++;
      }
      ops.push(op);
    } else if (line.startsWith(DELETE)) {
      ops.push({ type: "delete", path: line.slice(DELETE.length).trim() });
      i++;
    } else if (line.startsWith(UPDATE)) {
      const op = { type: "update", path: line.slice(UPDATE.length).trim(), chunks: [] };
      i++;
      if (i < lines.length && lines[i].startsWith(MOVE)) {
        op.moveTo = lines[i].slice(MOVE.length).trim();
        i++;
      }
      let chunk = null;
      const flush = () => {
        if (chunk && (chunk.old.length || chunk.new.length)) op.chunks.push(chunk);
        chunk = null;
      };
      while (i < lines.length && !(lines[i].startsWith("*** ") && lines[i] !== EOF_MARK)) {
        const l = lines[i];
        if (l === EOF_MARK) {
          if (chunk) chunk.atEof = true;
        } else if (l.startsWith("@@")) {
          flush();
          chunk = { anchor: l.slice(2).trim(), old: [], new: [] };
        } else {
          if (!chunk) chunk = { anchor: "", old: [], new: [] };
          const tag = l[0];
          const body = l.slice(1);
          if (tag === " " || l === "") {
            chunk.old.push(l === "" ? "" : body);
            chunk.new.push(l === "" ? "" : body);
          } else if (tag === "-") chunk.old.push(body);
          else if (tag === "+") chunk.new.push(body);
          else throw new PatchError(`Update File ${op.path}: line must start with " ", "-", "+" or "@@" (got "${l.slice(0, 40)}")`);
        }
        i++;
      }
      flush();
      if (!op.chunks.length && !op.moveTo) throw new PatchError(`Update File ${op.path}: no changes`);
      ops.push(op);
    } else if (line.trim() === "") {
      i++;
    } else {
      throw new PatchError(`unexpected line in patch: "${line.slice(0, 60)}"`);
    }
  }
  if (i >= lines.length) throw new PatchError(`patch must end with "${END}"`);
  if (!ops.length) throw new PatchError("patch has no file operations");
  return ops;
}

// Exact first, then ignoring trailing whitespace, then ignoring indentation —
// the same fallbacks the Codex CLI uses, so a hunk off by a stray space still lands.
const MATCHERS = [(a, b) => a === b, (a, b) => a.trimEnd() === b.trimEnd(), (a, b) => a.trim() === b.trim()];

function findSequence(haystack, needle, start, atEof) {
  if (!needle.length) return atEof ? haystack.length : start;
  for (const eq of MATCHERS) {
    const from = atEof ? Math.max(start, haystack.length - needle.length) : start;
    for (let i = from; i <= haystack.length - needle.length; i++) {
      let ok = true;
      for (let j = 0; j < needle.length; j++) {
        if (!eq(haystack[i + j], needle[j])) { ok = false; break; }
      }
      if (ok) return i;
    }
  }
  return -1;
}

/** Apply one Update op's chunks to a file's text. Throws PatchError on a miss. */
export function applyChunks(original, chunks, filePath) {
  const hadTrailingNewline = original.endsWith("\n");
  const lines = original.split("\n");
  if (hadTrailingNewline) lines.pop();
  let cursor = 0;
  for (const chunk of chunks) {
    if (chunk.anchor) {
      const at = findSequence(lines, [chunk.anchor], cursor, false);
      if (at < 0) throw new PatchError(`${filePath}: anchor "@@ ${chunk.anchor}" not found`);
      cursor = at + 1;
    }
    const at = findSequence(lines, chunk.old, cursor, !!chunk.atEof);
    if (at < 0) {
      const preview = chunk.old.slice(0, 4).join("\n");
      throw new PatchError(`${filePath}: could not find the lines to replace:\n${preview}\nRe-read the file and send the hunk again with its current text.`);
    }
    lines.splice(at, chunk.old.length, ...chunk.new);
    cursor = at + chunk.new.length;
  }
  return lines.join("\n") + (hadTrailingNewline || !original ? "\n" : "");
}

/**
 * Compute the change set. `io` is { exists(path), read(path) } over paths
 * already resolved by the caller. Returns [{ path, action, content?, from? }].
 */
export function planPatch(text, io) {
  const out = [];
  for (const op of parsePatch(text)) {
    if (op.type === "add") {
      if (io.exists(op.path)) throw new PatchError(`Add File ${op.path}: already exists — use Update File`);
      out.push({ path: op.path, action: "add", content: op.lines.join("\n") + "\n" });
    } else if (op.type === "delete") {
      if (!io.exists(op.path)) throw new PatchError(`Delete File ${op.path}: not found`);
      out.push({ path: op.path, action: "delete" });
    } else {
      if (!io.exists(op.path)) throw new PatchError(`Update File ${op.path}: not found`);
      const next = applyChunks(io.read(op.path), op.chunks, op.path);
      if (op.moveTo) {
        out.push({ path: op.moveTo, action: "add", content: next, from: op.path });
        out.push({ path: op.path, action: "delete" });
      } else {
        out.push({ path: op.path, action: "update", content: next });
      }
    }
  }
  return out;
}
