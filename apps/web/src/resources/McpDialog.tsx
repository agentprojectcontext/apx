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

/**
 * Adds one of the owner's MCP servers: a command it starts (stdio) or a URL (http). Secrets go in as `secret://NAME`
 * references to Variables, never as values in the definition.
 */
export function McpDialog(props: { onClose(): void; onSaved(name: string): void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("command");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [busy, setBusy] = useState(false);
  const parts = splitCommand(command);
  const valid = NAME.test(name) && (kind === "command" ? parts.length > 0 : /^https?:\/\/.+/.test(url));
  const save = async () => {
    setBusy(true);
    const extra = pairsToRecord(pairs);
    const server: McpDraft =
      kind === "command" ? { command: parts[0] ?? "", args: parts.slice(1), env: extra } : { url, headers: extra };
    const r = await setMcp(name, server);
    setBusy(false);
    if (r) props.onSaved(name);
  };
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && props.onClose()}
      title={t("res.newMcp")}
      description={t("res.newMcp.lead")}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!valid} loading={busy} onClick={() => void save()}>
            {t("res.create")}
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
          <span className="pform__hint">{t("res.pairsHint")}</span>
        </div>
      </div>
    </Dialog>
  );
}
