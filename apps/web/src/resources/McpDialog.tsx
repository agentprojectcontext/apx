import type { McpServerStatus } from "@apx/protocol";
import { Button, Dialog, Input, SegmentedControl } from "@apx/ui";
import { useState } from "react";
import { type McpDraft, setMcp } from "../data/resources.ts";
import { useT } from "../i18n/index.ts";
import { type Pair, PairsEditor, pairsToRecord } from "./PairsEditor.tsx";

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/;

/** A command line split on spaces, keeping "quoted parts" together. */
export function splitCommand(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

/** A command line from its parts: an argument with spaces goes back in quotes. */
const joinCommand = (parts: string[]) => parts.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(" ");
const toPairs = (r: Record<string, string> | undefined): Pair[] =>
  Object.entries(r ?? {}).map(([key, value]) => ({ key, value }));

/**
 * Adds one of the owner's MCP servers, or changes one (`server`): a command it starts (stdio) or a URL (http). Secrets
 * go in as `secret://NAME` references to Variables, never as values in the definition.
 */
export function McpDialog(props: {
  server?: McpServerStatus | undefined;
  onClose(): void;
  onSaved(name: string): void;
}) {
  const t = useT();
  const def = props.server?.definition;
  const [name, setName] = useState(props.server?.name ?? "");
  const [kind, setKind] = useState(def?.url ? "url" : "command");
  const [command, setCommand] = useState(def?.command ? joinCommand([def.command, ...def.args]) : "");
  const [url, setUrl] = useState(def?.url ?? "");
  const [pairs, setPairs] = useState<Pair[]>(toPairs(def?.url ? def.headers : def?.env));
  const [busy, setBusy] = useState(false);
  const parts = splitCommand(command);
  const valid = NAME.test(name) && (kind === "command" ? parts.length > 0 : /^https?:\/\/.+/.test(url));
  const save = async () => {
    setBusy(true);
    const extra = pairsToRecord(pairs);
    const server: McpDraft =
      kind === "command" ? { command: parts[0] ?? "", args: parts.slice(1), env: extra } : { url, headers: extra };
    // An edit keeps whether it was turned off.
    if (props.server && !props.server.enabled) server.enabled = false;
    const r = await setMcp(name, server);
    setBusy(false);
    if (r) props.onSaved(name);
  };
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && props.onClose()}
      title={props.server ? t("res.editMcp", { name: props.server.name }) : t("res.newMcp")}
      description={props.server ? undefined : t("res.newMcp.lead")}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid} loading={busy} onClick={() => void save()}>
            {props.server ? t("common.save") : t("res.create")}
          </Button>
        </>
      }
    >
      <div className="pform">
        <div className="pform__field">
          <span className="pform__label">{t("res.mcpName")}</span>
          <Input
            aria-label={t("res.mcpName")}
            value={name}
            disabled={Boolean(props.server)}
            placeholder="github"
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </div>
        <SegmentedControl
          size="sm"
          label={t("res.mcpKind")}
          value={kind}
          onValueChange={setKind}
          options={[
            { value: "command", label: t("res.command") },
            { value: "url", label: t("res.url") },
          ]}
        />
        {kind === "command" ? (
          <div className="pform__field">
            <span className="pform__label">{t("res.command")}</span>
            <Input
              aria-label={t("res.command")}
              className="resd__monoinput"
              value={command}
              placeholder="npx -y @acme/mcp-server"
              onChange={(e) => setCommand(e.currentTarget.value)}
            />
          </div>
        ) : (
          <div className="pform__field">
            <span className="pform__label">{t("res.url")}</span>
            <Input
              aria-label={t("res.url")}
              value={url}
              placeholder="https://mcp.example.com/mcp"
              onChange={(e) => setUrl(e.currentTarget.value)}
            />
          </div>
        )}
        <div className="pform__field">
          <span className="pform__label">{kind === "command" ? t("res.env") : t("res.headers")}</span>
          <PairsEditor
            keys={kind === "command" ? "env" : "headers"}
            label={kind === "command" ? t("res.env") : t("res.headers")}
            pairs={pairs}
            onChange={setPairs}
          />
        </div>
      </div>
    </Dialog>
  );
}
