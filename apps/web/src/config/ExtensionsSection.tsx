import type { ExtensionInfo } from "@apx/protocol";
import { Badge, Button, EmptyState, IconButton, Icons, Input, Switch } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { secretary } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { loadRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { SectionHead, SubHead } from "./SectionHead.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Extensions: folders that bring skills, MCP servers and routines. Installed off; turning one on approves its files. */
export function ExtensionsSection() {
  const t = useT();
  const [list, setList] = useState<ExtensionInfo[]>();
  const [folder, setFolder] = useState("");
  const [preview, setPreview] = useState<ExtensionInfo>();

  const call = useCallback(
    async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
      try {
        return await fn();
      } catch (e) {
        notify(t("error.extensions", { error: errText(e) }));
        return undefined;
      }
    },
    [t],
  );
  const load = useCallback(async () => {
    const r = await call(() => client.call("extensions.list", {}));
    if (r) setList(r.extensions);
  }, [call]);
  useEffect(() => {
    void load();
  }, [load]);

  const inspect = async () => setPreview(await call(() => client.call("extensions.inspect", { path: folder.trim() })));
  const install = async () => {
    if (await call(() => client.call("extensions.install", { path: folder.trim() }))) {
      setPreview(undefined);
      setFolder("");
      await load();
    }
  };

  return (
    <>
      <SectionHead title={t("config.extensions")} lead={t("ext.lead")} />
      <SubHead>{t("ext.add")}</SubHead>
      <div className="tgtoken">
        <Input
          aria-label={t("ext.folder")}
          placeholder={t("ext.folderHint")}
          value={folder}
          onChange={(e) => {
            setFolder(e.currentTarget.value);
            setPreview(undefined);
          }}
          onKeyDown={(e) => e.key === "Enter" && folder.trim() && void inspect()}
        />
        <Button size="sm" variant="secondary" disabled={!folder.trim()} onClick={() => void inspect()}>
          {t("ext.inspect")}
        </Button>
      </div>
      {preview && (
        <div className="pcard">
          <ExtensionSummary e={preview} />
          <div className="pcard__actions">
            <span className="pform__hint">{t("ext.installHint")}</span>
            <span className="pcard__spacer" />
            <Button size="sm" onClick={() => void install()}>
              {t("ext.install")}
            </Button>
          </div>
        </div>
      )}

      <SubHead>{t("ext.installed")}</SubHead>
      {list && !list.length ? (
        <EmptyState variant="dashed" size="sm" icon={<Icons.Layers />}>
          {t("ext.empty")}
        </EmptyState>
      ) : (
        list?.map((e) => <ExtensionCard key={e.id} e={e} call={call} onChanged={load} />)
      )}
    </>
  );
}

function ExtensionSummary({ e }: { e: ExtensionInfo }) {
  const t = useT();
  return (
    <>
      <div className="pcard__top">
        <div className="pcard__titles">
          <div className="pcard__name">
            {e.name} <span className="svc__dialect">v{e.version}</span>
          </div>
          <div className="pcard__id">
            {e.id} · {e.hash}
          </div>
        </div>
      </div>
      {e.description && <p className="config__lead">{e.description}</p>}
      <dl className="pcard__rows">
        <dt>{t("ext.skills")}</dt>
        <dd>{e.skills.join(", ") || "—"}</dd>
        <dt>{t("ext.mcp")}</dt>
        <dd>{e.mcp.join(", ") || "—"}</dd>
        <dt>{t("ext.routines")}</dt>
        <dd>{e.routines.map((r) => r.name).join(", ") || "—"}</dd>
        {e.plugin && (
          <>
            <dt>{t("ext.plugin")}</dt>
            <dd>
              {[
                e.plugin.observe.length ? t("ext.plugin.watches", { events: e.plugin.observe.join(", ") }) : "",
                e.plugin.context ? t("ext.plugin.context") : "",
                e.plugin.network ? t("ext.plugin.network") : "",
              ]
                .filter(Boolean)
                .join(" · ") || "—"}
            </dd>
          </>
        )}
        <dt>{t("ext.source")}</dt>
        <dd>{e.source}</dd>
      </dl>
      {e.runs_code && (
        <p className="pform__hint">
          <Icons.TriangleAlert size={12} /> {t("ext.runsCode")}
        </p>
      )}
      {e.plugin?.status === "error" && (
        <Badge tone="danger" dot>
          {t("ext.plugin.error", { error: e.plugin.error ?? "" })}
        </Badge>
      )}
    </>
  );
}

function ExtensionCard({
  e,
  call,
  onChanged,
}: {
  e: ExtensionInfo;
  call: <R>(fn: () => Promise<R>) => Promise<R | undefined>;
  onChanged: () => Promise<void>;
}) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const run = async (fn: () => Promise<unknown>) => {
    await call(fn);
    await onChanged();
  };
  const addRoutine = async (r: ExtensionInfo["routines"][number]) => {
    const agent = secretary(agents)?.id;
    if (!agent) return;
    // Added off: the owner reviews it in Routines before it runs on its own.
    const saved = await call(() =>
      client.call("routines.set", { name: r.name, agent, schedule: r.schedule, prompt: r.prompt, enabled: false }),
    );
    if (saved) {
      notify(t("ext.routineAdded", { name: r.name }));
      void loadRoutines();
    }
  };
  return (
    <div className={e.enabled ? "pcard extcard" : "pcard extcard is-off"}>
      <ExtensionSummary e={e} />
      {e.secrets.map((s) => (
        <SecretRow
          key={s.name}
          label={s.label}
          set={s.set}
          url={s.url}
          onSave={(value) => run(() => client.call("extensions.set_secret", { id: e.id, name: s.name, value }))}
        />
      ))}
      {e.routines.map((r) => (
        <div key={r.name} className="tgtoken">
          <Icons.Clock size={14} />
          <span className="res__name">{r.name}</span>
          <span className="pcard__spacer" />
          <Button size="sm" variant="secondary" onClick={() => void addRoutine(r)}>
            {t("ext.addRoutine")}
          </Button>
        </div>
      ))}
      <div className="pcard__actions">
        <Switch
          size="sm"
          checked={e.enabled}
          label={e.enabled ? t("ext.on") : t("ext.off")}
          onCheckedChange={(on) => void run(() => client.call("extensions.enable", { id: e.id, enabled: on }))}
        />
        <span className="pcard__spacer" />
        <IconButton
          size="sm"
          label={t("ext.remove")}
          icon={<Icons.Trash2 size={14} />}
          onClick={() => void run(() => client.call("extensions.remove", { id: e.id }))}
        />
      </div>
    </div>
  );
}

/** A secret the extension needs: typed once, never shown again. */
function SecretRow(props: {
  label: string;
  set: boolean;
  url?: string | undefined;
  onSave: (value: string | null) => Promise<void>;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  return (
    <div className="tgtoken">
      <Input
        type="password"
        autoComplete="off"
        aria-label={props.label}
        placeholder={props.set ? t("ext.secretSet", { label: props.label }) : props.label}
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
      />
      {props.set && !value ? (
        <>
          <Badge tone="brand" dot>
            {t("ext.saved")}
          </Badge>
          <Button size="sm" variant="secondary" onClick={() => void props.onSave(null)}>
            {t("ext.clear")}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          disabled={!value}
          onClick={() =>
            void props.onSave(value).then(() => {
              setValue("");
            })
          }
        >
          {t("common.save")}
        </Button>
      )}
      {props.url && (
        <a className="pform__hint" href={props.url} target="_blank" rel="noreferrer">
          {t("ext.getIt")}
        </a>
      )}
    </div>
  );
}
