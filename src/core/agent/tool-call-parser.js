// Pseudo-tool-call parser.
//
// Some models — qwen2.5:14b under Ollama is the canonical offender — emit
// "tool calls as text" instead of using the structured `tool_calls` field of
// the chat API. The output looks like:
//
//   <tool_call>
//   {"name": "list_agents", "arguments": {"project": "X"}}
//   </tool_call>
//   <tool_call>
//   {"name": "send_telegram", "arguments": {"text": "..."}}
//   </tool_call>
//
// or sometimes prefixed with `_icall()` or wrapped in fenced code blocks.
//
// `extractPseudoToolCalls(text)` finds those patterns and returns an array of
// `{ id, function: { name, arguments } }` objects shaped like real Ollama
// tool_calls — so the agent loop can treat them identically.
//
// `cleanTextOfPseudoToolCalls(text)` returns the input text minus the
// pseudo-tool-call blocks, so the loop never sends them as plain text to the
// user when the model fell back to this mode.

let counter = 0;
function nextId() {
  return `pseudo_${Date.now().toString(36)}_${counter++}`;
}

// Find a balanced JSON object starting at index `i` of `s`. Returns
// { ok: true, end: <index after closing brace> } or { ok: false }.
function readBalancedJson(s, i) {
  if (s[i] !== "{") return { ok: false };
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let p = i; p < s.length; p++) {
    const c = s[p];
    if (escape) { escape = false; continue; }
    if (inStr) {
      if (c === "\\") escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { ok: true, end: p + 1 };
    }
  }
  return { ok: false };
}

// Walk the text looking for `{` characters that start an object containing
// keys "name" and "arguments". Tolerant: accepts whatever wrapper text comes
// before/after.
export function extractPseudoToolCalls(text) {
  if (!text || typeof text !== "string") return [];
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const balanced = readBalancedJson(text, i);
    if (!balanced.ok) continue;
    const candidate = text.slice(i, balanced.end);
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.name === "string" &&
      "arguments" in parsed &&
      typeof parsed.arguments === "object" &&
      parsed.arguments !== null &&
      !Array.isArray(parsed.arguments)
    ) {
      out.push({
        id: nextId(),
        function: {
          name: parsed.name,
          arguments: parsed.arguments,
        },
        _pseudo: true,
        _raw: candidate,
      });
      i = balanced.end - 1;
    }
  }
  return out;
}

// Remove the parts of `text` that match pseudo-tool-call blocks plus any
// trivial wrappers (<tool_call>, ```tool_use, _icall(), etc.) that often sit
// around them. Used to clean up final answers that the model emitted with
// leftover textual tool-call gunk.
export function cleanTextOfPseudoToolCalls(text) {
  if (!text || typeof text !== "string") return text;

  // Strip explicit XML-like fences first
  let out = text.replace(/<\/?tool_call>/gi, "");
  out = out.replace(/<\/?tool_use>/gi, "");
  out = out.replace(/_icall\(\s*\)/g, "");
  out = out.replace(/```tool_(?:call|use)\s*([\s\S]*?)```/gi, "");

  // Now drop balanced JSON objects that were tool-call-shaped
  const calls = extractPseudoToolCalls(out);
  for (const c of calls) {
    out = out.replace(c._raw, "");
  }
  // Tidy up whitespace & blank lines
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}
