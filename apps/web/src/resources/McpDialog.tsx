import "../styles/resources.css";
import "./mcp-editor.css";
import type { McpServerStatus } from "@apx/protocol";
import { Button, Dialog, Input, SegmentedControl } from "@apx/ui";
import { useState } from "react";
import { projectName } from "../data/identity.ts";
import { type McpDraft, setMcp } from "../data/resources.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { McpAvailability } from "./McpAvailability.tsx";
import { type Pair, PairsEditor, pairsToRecord } from "./PairsEditor.tsx";

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/;

/** A command line split on spaces, keeping "quoted parts" together. */
function splitCommand(line: string): string[] {
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
  projectId?: string | undefined;
  onClose(): void;
  onSaved(name: string): void;
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const def = props.server?.definition;
  const [available, setAvailable] = useState(
    props.server
      ? props.server.only
        ? (props.server.project_id ?? "global")
        : "global"
      : (props.projectId ?? "global"),
  );
  const [offIn, setOffIn] = useState<string[]>(props.server?.off_in ?? []);
  const privateServer = props.server?.scope !== "project";
  const [name, setName] = useState(props.server?.name ?? "");
  const [kind, setKind] = useState(def?.url ? "url" : "command");
  const [command, setCommand] = useState(def?.command ? joinCommand([def.command, ...def.args]) : "");
  const [url, setUrl] = useState(def?.url ?? "");
  const [pairs, setPairs] = useState<Pair[]>(toPairs(def?.url ? def.headers : def?.env));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const parts = splitCommand(command);
  const valid = NAME.test(name) && (kind === "command" ? parts.length > 0 : /^https?:\/\/.+/.test(url));
  const save = async () => {
    setBusy(true);
    setFailed(false);
    const extra = pairsToRecord(pairs);
    const server: McpDraft =
      kind === "command"
        ? { command: parts[0] ?? "", args: parts.slice(1), env: extra }
        : { url, headers: extra, ...(def?.env ? { env: def.env } : {}) };
    if (privateServer) {
      server.project = available === "global" ? null : available;
      if (available === "global") server.off_in = offIn;
    }
    // An edit keeps whether it was turned off.
    if (props.server && !props.server.enabled) server.enabled = false;
    const r = await setMcp(name, server, props.server?.scope === "project" ? props.server.project_id : undefined);
    setBusy(false);
    if (r) props.onSaved(name);
    else setFailed(true);
  };
  return (
    <Dialog
      open
      size="lg"
      closeLabel={t("common.close")}
      onOpenChange={(o) => !o && props.onClose()}
      title={props.server ? t("res.editMcp", { name: props.server.name }) : t("res.newMcp")}
      description={
        props.server?.scope === "project" ? t("res.editProjectMcp") : props.server ? undefined : t("res.newMcp.lead")
      }
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
      <div className="pform mcp-editor">
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
            vars={privateServer}
            project={available === "global" ? undefined : available}
            keys={kind === "command" ? "env" : "headers"}
            label={kind === "command" ? t("res.env") : t("res.headers")}
            pairs={pairs}
            onChange={setPairs}
          />
        </div>
        {privateServer ? (
          <McpAvailability
            lives={available}
            onLives={setAvailable}
            offIn={offIn}
            onOffIn={setOffIn}
            values={[...pairs.map((pair) => pair.value), ...(kind === "url" ? Object.values(def?.env ?? {}) : [])]}
          />
        ) : (
          <div className="pform__field">
            <span className="pform__label">{t("res.mcpLives")}</span>
            <p className="resd__note">
              {t("res.mcpLivesRepo", { name: projectName(projects, props.server?.project_id) })}
            </p>
          </div>
        )}
        {failed && (
          <p role="alert" className="resd__error">
            {t("res.mcpSaveError")}
          </p>
        )}
      </div>
    </Dialog>
  );
}
