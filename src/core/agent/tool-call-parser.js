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

  // First pass: the Llama-3.3 (via Groq / OpenRouter) "dotted function"
  // format: <function.NAME({...JSON...})</function>. The model emits this
  // when it tries to do structured tool calling without proper SDK support.
  // We translate each match into a regular pseudo-tool-call entry; the
  // run-agent loop then treats them identically.
  const llamaCalls = extractLlamaDottedFunctionCalls(text);

  // Second pass: balanced `{name, arguments}` JSON anywhere in the text.
  const jsonCalls = [];
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
      // Skip JSON that is actually the args object inside a dotted-function
      // wrapper we already captured — otherwise we'd double-fire the tool.
      const insideLlamaWrap = llamaCalls.some(
        (lc) => lc._rawStart <= i && balanced.end <= lc._rawEnd
      );
      if (insideLlamaWrap) {
        i = balanced.end - 1;
        continue;
      }
      jsonCalls.push({
        id: nextId(),
        function: { name: parsed.name, arguments: parsed.arguments },
        _pseudo: true,
        _raw: candidate,
      });
      i = balanced.end - 1;
    }
  }

  // Strip internal markers used to dedupe against JSON pass.
  return [
    ...llamaCalls.map(({ _rawStart, _rawEnd, ...rest }) => rest),
    ...jsonCalls,
  ];
}

// Parse the dotted-function format emitted by some Llama instructions:
//
//   <function.send_telegram({"text": "hi"})</function>
//   <function.list_projects({})</function>
//
// We accept missing closing tags (model sometimes truncates) and tolerate
// whitespace between the name, the parens, and the args object.
function extractLlamaDottedFunctionCalls(text) {
  const out = [];
  const re = /<function\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*(\{)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const argsStart = m.index + m[0].length - 1; // position of the `{`
    const balanced = readBalancedJson(text, argsStart);
    if (!balanced.ok) continue;
    const argsBlob = text.slice(argsStart, balanced.end);
    let args;
    try {
      args = JSON.parse(argsBlob);
    } catch {
      continue;
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) continue;

    // Find the end of the wrapper: optional ")", optional "</function>".
    let cursor = balanced.end;
    if (text[cursor] === ")") cursor++;
    const tail = text.slice(cursor, cursor + 16);
    const closeMatch = tail.match(/^\s*<\/function>/i);
    if (closeMatch) cursor += closeMatch[0].length;

    out.push({
      id: nextId(),
      function: { name, arguments: args },
      _pseudo: true,
      _raw: text.slice(m.index, cursor),
      _rawStart: m.index,
      _rawEnd: cursor,
    });
    // Advance regex past the closing brace so we don't double-match.
    re.lastIndex = cursor;
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

  // The Llama "dotted-function" wrapper. Drop the whole block — both the
  // opening `<function.NAME(` and the trailing `)</function>` — so the user
  // never sees the wire format. Greedy on balanced braces would be wrong
  // (model might emit JSON later in the same message), so we use the same
  // extractor we built for the call-parsing pass and remove its raw spans.
  for (const call of extractPseudoToolCalls(out)) {
    if (call._raw) out = out.replace(call._raw, "");
  }
  // Some models emit a stray `</function>` after the args without the
  // opening tag — sweep those too.
  out = out.replace(/<\/?function(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?>/gi, "");

  // Tidy up whitespace & blank lines
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}
