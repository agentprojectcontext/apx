import "./CodeBlock.css";
import { secureRequestKey } from "@apx/protocol/client";
import { CodeFrame, type CodeFrameLabels, Skeleton, Spinner } from "@apx/ui";
import { type ReactElement, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { CodeView, MermaidDiagram } from "../lazy.ts";
import { htmlPreviewDoc, isPreviewHeight } from "./htmlPreview.ts";

/** How a fence's word reads in the header; any other word shows with a capital first letter. */
const NAMES: Record<string, string> = {
  html: "HTML",
  htm: "HTML",
  mermaid: "Mermaid",
  js: "JavaScript",
  javascript: "JavaScript",
  jsx: "JSX",
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  json: "JSON",
  jsonc: "JSON",
  css: "CSS",
  scss: "SCSS",
  py: "Python",
  python: "Python",
  sql: "SQL",
  yml: "YAML",
  yaml: "YAML",
  xml: "XML",
  svg: "SVG",
  md: "Markdown",
  markdown: "Markdown",
  php: "PHP",
};

/** The file name CodeView reads its colors from (it picks a language by extension). */
const EXTENSIONS: Record<string, string> = { javascript: "js", typescript: "ts", python: "py", markdown: "md" };

function useCodeLabels(): Partial<CodeFrameLabels> {
  const t = useT();
  return useMemo(
    () => ({
      preview: t("md.preview"),
      source: t("md.source"),
      showAs: t("md.showAs"),
      copy: t("msg.copy"),
      copied: t("msg.copied"),
      expand: t("md.expand"),
      close: t("common.close"),
    }),
    [t],
  );
}

/**
 * A fenced block an agent wrote, in a frame with its language, Copy and Expand; its code highlighted with line
 * numbers. An HTML page and a Mermaid diagram start on what they draw, with a switch to their code. While the agent is
 * still `writing` it, its code comes in line by line and what it draws shows once it is whole.
 */
export function CodeBlock({
  code,
  lang,
  pre,
  writing = false,
}: {
  code: string;
  lang: string | undefined;
  pre: ReactElement;
  writing?: boolean;
}) {
  const t = useT();
  const labels = useCodeLabels();
  const language = lang ? (NAMES[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1)) : t("md.plainText");
  const source = (
    <Suspense fallback={pre}>
      <CodeView path={`block.${lang ? (EXTENSIONS[lang] ?? lang) : "txt"}`} text={code} editable={false} snippet />
    </Suspense>
  );
  const kind = writing ? undefined : NAMES[lang ?? ""];
  const preview =
    kind === "HTML" ? (
      <HtmlPreview html={code} title={t("md.htmlFrame")} />
    ) : kind === "Mermaid" ? (
      <Suspense fallback={<Skeleton shape="block" height={160} />}>
        <MermaidDiagram code={code} label={t("md.diagram")} failed={t("md.diagramFailed")} fallback={source} />
      </Suspense>
    ) : undefined;
  return (
    <CodeFrame
      language={language}
      code={code}
      preview={preview}
      status={
        writing ? (
          <>
            <Spinner size={12} />
            {t("md.writing")}
          </>
        ) : undefined
      }
      labels={labels}
      className="codeblock"
    >
      {source}
    </CodeFrame>
  );
}

/** Tall pages scroll inside the block; this only keeps a runaway page from making the frame endless. */
const MAX_FRAME = 4000;

/**
 * The page drawn in a sandboxed frame: an opaque origin with no script of its own (htmlPreview.ts), so it cannot
 * reach APX or the web. The frame takes the page's height.
 */
function HtmlPreview({ html, title }: { html: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const nonce = useMemo(() => secureRequestKey(), []);
  const [height, setHeight] = useState(120);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !isPreviewHeight(e.data, nonce)) return;
      setHeight(Math.max(40, Math.min(MAX_FRAME, Math.round(e.data.height))));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [nonce]);
  const doc = useMemo(() => htmlPreviewDoc(html, nonce), [html, nonce]);
  return (
    <iframe
      ref={frame}
      title={title}
      className="codeblock__frame"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={doc}
      style={{ height }}
    />
  );
}
