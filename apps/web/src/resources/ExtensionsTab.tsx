import type { ExtensionInfo } from "@apx/protocol";
import { Badge, Button, Dialog, EmptyState, IconButton, Icons, Input, Switch } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { SubHead } from "../config/SectionHead.tsx";
import { client } from "../data/client.ts";
import { DEFAULT_PID, secretary } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { loadRoutines, useRoutines } from "../data/routines.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { scheduleText } from "../routines/Schedule.tsx";
import { go } from "../shell/nav.ts";
import { ExtensionGuide } from "./ExtensionGuide.tsx";
import { ExtensionTest } from "./ExtensionTest.tsx";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Extensions, last of the Resources tabs: folders that bring skills, MCP servers and routines. Installed off; turning
 * one on approves its files. "+ Install" opens the folder picker.
 */
export function ExtensionsTab({
  adding,
  setAdding,
  onChanged,
}: {
  adding: boolean;
  setAdding(on: boolean): void;
  onChanged(): void;
}) {
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
  // The parent's callback changes every render; read it through a ref so loading does not re-run with it.
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const load = useCallback(async () => {
    const r = await call(() => client.call("extensions.list", {}));
    if (r) setList(r.extensions);
    changed.current();
  }, [call]);
  useEffect(() => {
    void load();
  }, [load]);

  const inspect = async () => setPreview(await call(() => client.call("extensions.inspect", { path: folder.trim() })));
  const install = async () => {
    if (await call(() => client.call("extensions.install", { path: folder.trim() }))) {
      setPreview(undefined);
      setFolder("");
      setAdding(false);
      await load();
    }
  };

  return (
    <div className="resext">
      <p className="resvars__note">{t("ext.lead")}</p>
      <ExtensionGuide />
      {adding && (
        <>
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
        </>
      )}
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
    </div>
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
        {e.plugin && (
          <>
            <dt>{t("ext.plugin")}</dt>
            <dd>
              {[
                e.plugin.observe.length ? t("ext.plugin.watches", { events: e.plugin.observe.join(", ") }) : "",
                e.plugin.context ? t("ext.plugin.context") : "",
                e.plugin.network ? t(e.plugin.local_network ? "ext.plugin.localNetwork" : "ext.plugin.network") : "",
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
  const [editing, setEditing] = useState(false);
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
      notify(t("ext.routineAdded", { name: r.name }), "info");
      void loadRoutines();
    }
  };
  return (
    <div className={e.enabled ? "pcard extcard" : "pcard extcard is-off"}>
      <ExtensionSummary e={e} />
      {e.secrets.some((s) => !s.set) && (
        <Badge tone="warning" dot>
          {t("ext.missingSecrets", { n: e.secrets.filter((s) => !s.set).length })}
        </Badge>
      )}
      {e.routines.length > 0 && <ExtensionRoutines e={e} onAdd={addRoutine} />}
      <ExtensionTest e={e} />
      <div className="pcard__actions">
        <Switch
          size="sm"
          checked={e.enabled}
          label={e.enabled ? t("ext.on") : t("ext.off")}
          onCheckedChange={(on) => void run(() => client.call("extensions.enable", { id: e.id, enabled: on }))}
        />
        <span className="pcard__spacer" />
        <Button size="sm" variant="secondary" leadingIcon={<Icons.Pencil size={14} />} onClick={() => setEditing(true)}>
          {t("res.edit")}
        </Button>
        <IconButton
          size="sm"
          label={t("ext.remove")}
          icon={<Icons.Trash2 size={14} />}
          onClick={() => void run(() => client.call("extensions.remove", { id: e.id }))}
        />
      </div>
      {editing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setEditing(false)}
          title={t("res.editMcp", { name: e.name })}
          footer={
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t("common.close")}
            </Button>
          }
        >
          <div className="pform">
            {e.secrets.length > 0 && <span className="pform__label">{t("ext.secrets")}</span>}
            {e.secrets.map((s) => (
              <SecretRow
                key={s.name}
                label={s.label}
                set={s.set}
                url={s.url}
                onSave={(value) => run(() => client.call("extensions.set_secret", { id: e.id, name: s.name, value }))}
              />
            ))}
            <span className="pform__label">{t("ext.reload")}</span>
            <p className="pform__hint">{t("ext.reloadHint", { folder: e.source })}</p>
            <div>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Icons.RefreshCw size={14} />}
                onClick={() => void run(() => client.call("extensions.install", { path: e.source }))}
              >
                {t("ext.reloadButton")}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
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

/**
 * The routines an extension suggests: what each one would do and when. None runs by itself: added, it waits in
 * Routines (Default project) turned off until the owner turns it on; once there, this says so and opens it.
 */
function ExtensionRoutines({
  e,
  onAdd,
}: {
  e: ExtensionInfo;
  onAdd(r: ExtensionInfo["routines"][number]): Promise<void>;
}) {
  const t = useT();
  const routines = useRoutines((s) => s.routines);
  const ready = useRoutines((s) => s.ready);
  useEffect(() => {
    if (!ready) void loadRoutines();
  }, [ready]);
  return (
    <div className="extroutines">
      <span className="pform__label">{t("ext.routinesTitle")}</span>
      <p className="pform__hint">{t("ext.routinesLead")}</p>
      {e.routines.map((r) => {
        const there = routines.find((x) => x.name === r.name && !x.project_id);
        return (
          <div key={r.name} className="extroutine">
            <Icons.Clock size={14} className="extroutine__icon" />
            <div className="extroutine__main">
              <div className="extroutine__name">
                {r.name} <span className="extroutine__when">· {scheduleText(r.schedule, t)}</span>
              </div>
              <div className="extroutine__prompt">{r.prompt.split("\n").find((l) => l.trim()) ?? ""}</div>
            </div>
            {there ? (
              <>
                <Badge tone={there.enabled ? "brand" : "neutral"} dot>
                  {there.enabled ? t("ext.routineOn") : t("ext.routineOff")}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => go.project(DEFAULT_PID, "routines")}>
                  {t("ext.routineOpen")}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Icons.Plus size={14} />}
                onClick={() => void onAdd(r)}
              >
                {t("ext.addRoutine")}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
