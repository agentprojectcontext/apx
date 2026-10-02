import { renderToStaticMarkup } from "react-dom/server";
import { EngineIcon } from "@apx/ui";
const ids = ["claude", "codex", "acp:gemini", "openai", "ollama", "acp:opencode"];
const row = (tile: boolean, size: number) => ids.map((id) => renderToStaticMarkup(<EngineIcon engine={id} tile={tile} size={size} />)).join(" ");
console.log(`<html><head><link rel="stylesheet" href="file:///home/user/apx-v2/packages/ui/dist/styles.css"></head><body class="apx" style="padding:20px;display:grid;gap:16px">
<div style="display:flex;gap:12px">${row(true, 32)}</div><div style="display:flex;gap:12px">${row(false, 32)}</div><div style="display:flex;gap:12px">${row(true, 20)}</div></body></html>`);
