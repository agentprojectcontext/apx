import type { Result } from "@apx/protocol";
import {
  Badge,
  Button,
  ContextMenu,
  Dialog,
  EmptyState,
  Field,
  Icons,
  Input,
  IntegrationIcon,
  MasterDetail,
  PickRow,
  ProjectTile,
  SegmentedControl,
  Switch,
} from "@apx/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { client } from "../data/client.ts";
import { loadMarks } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { GoogleSignInForm } from "./GoogleSignIn.tsx";
import type { TabProps } from "./ResourcesView.tsx";

type Integration = Result<"integrations.list">["integrations"][number];
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** What each one is, in the owner's language (the core's text otherwise). */
const DESC: Record<string, MessageKey> = {
  github: "int.desc.github",
  notion: "int.desc.notion",
  slack: "int.desc.slack",
  sentry: "int.desc.sentry",
  "brave-search": "int.desc.bravesearch",
  obsidian: "int.desc.obsidian",
  "google-calendar": "int.desc.googlecalendar",
  gmail: "int.desc.gmail",
  "google-drive": "int.desc.googledrive",
  linear: "int.desc.linear",
  asana: "int.desc.asana",
};
const describe = (i: Integration, t: ReturnType<typeof useT>) =>
  DESC[i.id] ? t(DESC[i.id] as MessageKey) : i.description;

function Tile({ i, size = 32 }: { i: Pick<Integration, "id" | "label">; size?: number }) {
  return <IntegrationIcon id={i.id} name={i.label} size={size} />;
}

/**
 * Integrations: an account connected once (GitHub, Notion, Slack…) that brings its MCP server and the variables it
 * needs. The list holds the connected ones; each says where it is used, project by project.
 */
export function IntegrationsTab({ projectId, query, scope, adding, setAdding }: TabProps) {
  const t = useT();
  const all = useData((s) => s.projects);
  const projects = useMemo(() => all.filter((p) => p.path && p.registered !== false), [all]);
  const [list, setList] = useState<Integration[]>();
  const [picked, setPicked] = useState<string>();
  /** "Edit" from the list's menu: the detail opens with its form (a new number opens it again). */
  const [editing, setEditing] = useState(0);
  const load = useCallback(async () => {
    try {
      setList((await client.call("integrations.list", {})).integrations);
    } catch (e) {
      notify(t("error.load", { error: errText(e) }));
    }
  }, [t]);
  useEffect(() => {
    loadMarks();
    void load();
  }, [load]);

  const toggle = async (id: string, project: string, on: boolean) => {
    try {
      await client.call("mcp.toggle", { project, server: id, on });
      await load();
    } catch (e) {
      notify(t("error.change", { error: errText(e) }));
    }
  };

  const connected = (list ?? [])
    .filter((i) => i.connected)
    .filter((i) => !query || `${i.label} ${describe(i, t)}`.toLowerCase().includes(query))
    .filter((i) => scope === "all" || scope === "global" || !i.off_in.includes(scope));

  // Inside a project: its integrations, each on or off here.
  if (projectId)
    return (
      <div className="resvars">
        {!connected.length ? (
          <EmptyState variant="dashed" icon={<Icons.Plug />}>
            {t("int.noneHere")}
          </EmptyState>
        ) : (
          <div className="int__rows">
            {connected.map((i) => (
              <div key={i.id} className="int__row">
                <Tile i={i} />
                <span className="int__rowmain">
                  <b>{i.label}</b>
                  <span>{describe(i, t)}</span>
                </span>
                <Switch
                  size="sm"
                  aria-label={i.label}
                  checked={!i.off_in.includes(projectId)}
                  onCheckedChange={(on) => void toggle(i.id, projectId, on)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );

  const current = connected.find((i) => i.id === picked) ?? connected[0];
  const disconnect = async (id: string) => {
    try {
      await client.call("integrations.disconnect", { id });
      await load();
    } catch (e) {
      notify(t("error.change", { error: errText(e) }));
    }
  };
  const dialog = adding && list && (
    <ConnectDialog
      list={list}
      onClose={() => setAdding(false)}
      onConnected={async (id) => {
        setAdding(false);
        await load();
        setPicked(id);
      }}
    />
  );
  // Nothing connected yet: the invitation alone, no empty list beside it.
  if (list && !list.some((i) => i.connected))
    return (
      <div className="resvars">
        <EmptyState
          variant="dashed"
          icon={<Icons.Plug />}
          title={t("int.emptyTitle")}
          action={
            <Button size="sm" leadingIcon={<Icons.Plus size={14} />} onClick={() => setAdding(true)}>
              {t("int.connectNew")}
            </Button>
          }
        >
          {t("int.emptyBody")}
        </EmptyState>
        {dialog}
      </div>
    );
  return (
    <>
      <MasterDetail
        resizeKey="integrations"
        listLabel={t("res.tab.integrations")}
        backLabel={t("res.tab.integrations")}
        onBack={() => setPicked(undefined)}
        list={
          <>
            <div className="int__listhead">{t("int.connected")}</div>
            {connected.map((i) => (
              <ContextMenu
                key={i.id}
                items={[
                  { label: t("res.open"), icon: <Icons.PanelRight size={14} />, onSelect: () => setPicked(i.id) },
                  {
                    label: t("res.edit"),
                    icon: <Icons.Pencil size={14} />,
                    onSelect: () => {
                      setPicked(i.id);
                      setEditing(Date.now());
                    },
                  },
                  { type: "separator" },
                  {
                    label: t("int.disconnect"),
                    icon: <Icons.Unplug size={14} />,
                    danger: true,
                    onSelect: () => void disconnect(i.id),
                  },
                ]}
              >
                <PickRow
                  title={i.label}
                  description={where(i, projects.length, t)}
                  leading={<Tile i={i} />}
                  dot="on"
                  selected={current?.id === i.id}
                  onClick={() => setPicked(i.id)}
                />
              </ContextMenu>
            ))}
            <Button
              size="sm"
              variant="secondary"
              className="int__add"
              leadingIcon={<Icons.Plus size={14} />}
              onClick={() => setAdding(true)}
            >
              {t("int.connectNew")}
            </Button>
          </>
        }
        detail={
          current ? (
            <IntegrationDetail
              key={`${current.id}:${editing}`}
              i={current}
              projects={projects}
              onToggle={toggle}
              onChanged={load}
              editing={editing > 0}
            />
          ) : undefined
        }
        empty={
          <EmptyState variant="dashed" icon={<Icons.Plug />} title={t("int.emptyTitle")}>
            {t("int.emptyBody")}
          </EmptyState>
        }
      />
      {dialog}
    </>
  );
}

function where(i: Integration, total: number, t: ReturnType<typeof useT>): string {
  if (!i.off_in.length) return t("int.everywhere");
  return t("int.inSome", { n: total - i.off_in.length, total });
}

function IntegrationDetail({
  i,
  projects,
  onToggle,
  onChanged,
  editing = false,
}: {
  i: Integration;
  projects: Array<{ id: string; name: string }>;
  onToggle(id: string, project: string, on: boolean): Promise<void>;
  onChanged(): Promise<void>;
  editing?: boolean;
}) {
  const t = useT();
  const [mode, setMode] = useState<"all" | "chosen">(i.off_in.length ? "chosen" : "all");
  const [account, setAccount] = useState(editing);
  const [busy, setBusy] = useState(false);
  useEffect(() => setMode(i.off_in.length ? "chosen" : "all"), [i.off_in.length]);
  const everywhere = async () => {
    setMode("all");
    for (const p of i.off_in) await onToggle(i.id, p, true);
  };
  const disconnect = async () => {
    setBusy(true);
    try {
      await client.call("integrations.disconnect", { id: i.id });
      await onChanged();
    } catch (e) {
      notify(t("error.change", { error: errText(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="int__detail">
      <header className="int__head">
        <Tile i={i} size={44} />
        <span className="int__titles">
          <b>{i.label}</b>
          <span>
            {i.oauth?.account ? t("int.signedInAs", { account: i.oauth.account }) : t("int.connectedAs")} ·{" "}
            {where(i, projects.length, t)}
          </span>
        </span>
        <Button size="sm" variant="secondary" leadingIcon={<Icons.Pencil size={14} />} onClick={() => setAccount(true)}>
          {t("res.edit")}
        </Button>
        <Button size="sm" variant="ghost" loading={busy} onClick={() => void disconnect()}>
          {t("int.disconnect")}
        </Button>
      </header>
      <p className="int__desc">{describe(i, t)}</p>
      <div className="int__usehead">
        <b>{t("int.usedIn")}</b>
        <SegmentedControl
          size="sm"
          label={t("int.usedIn")}
          value={mode}
          onValueChange={(v) => (v === "all" ? void everywhere() : setMode("chosen"))}
          options={[
            { value: "all", label: t("int.allProjects") },
            { value: "chosen", label: t("int.chosen") },
          ]}
        />
      </div>
      <div className="int__rows">
        <div className="int__row">
          <ProjectTile tone="brand" initial="D" size={28} />
          <span className="int__rowmain">
            <b>Default</b>
            <span>{t("int.defaultAlways")}</span>
          </span>
          <Badge>{t("int.on")}</Badge>
        </div>
        {projects.map((p) => {
          const on = !i.off_in.includes(p.id);
          return (
            <div key={p.id} className="int__row">
              <ProjectTile tone="info" initial={p.name.slice(0, 1).toUpperCase()} size={28} />
              <span className="int__rowmain">
                <b>{p.name}</b>
                <span>{on ? t("int.on") : t("int.off")}</span>
              </span>
              <Switch
                size="sm"
                aria-label={p.name}
                checked={on}
                disabled={mode === "all"}
                onCheckedChange={(v) => void onToggle(i.id, p.id, v)}
              />
            </div>
          );
        })}
      </div>
      {account && (
        <ConnectForm
          i={i}
          title={t("res.editMcp", { name: i.label })}
          onClose={() => setAccount(false)}
          onDone={async () => {
            setAccount(false);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

/** The catalog: what can be connected, and what is still coming. */
function ConnectDialog({
  list,
  onClose,
  onConnected,
}: {
  list: Integration[];
  onClose(): void;
  onConnected(id: string): Promise<void>;
}) {
  const t = useT();
  const [chosen, setChosen] = useState<Integration>();
  if (chosen)
    return (
      <ConnectForm
        i={chosen}
        title={t("int.connectTitle", { name: chosen.label })}
        onClose={() => setChosen(undefined)}
        onDone={() => onConnected(chosen.id)}
      />
    );
  return (
    <Dialog open size="lg" onOpenChange={(o) => !o && onClose()} title={t("int.catalog")}>
      <div className="int__catalog">
        {list
          .filter((i) => !i.connected)
          .map((i) => (
            <button
              key={i.id}
              type="button"
              className={`int__card${i.coming ? " is-coming" : ""}`}
              disabled={i.coming}
              onClick={() => setChosen(i)}
            >
              <Tile i={i} />
              <span className="int__rowmain">
                <b>{i.label}</b>
                <span>{describe(i, t)}</span>
              </span>
              {i.coming && <Badge>{t("setup.channels.soon")}</Badge>}
            </button>
          ))}
      </div>
    </Dialog>
  );
}

/** An account signed in to (Google), or one connected by its token. */
function ConnectForm(props: Parameters<typeof TokenForm>[0]) {
  return props.i.oauth ? <GoogleSignInForm {...props} /> : <TokenForm {...props} />;
}

/** Its fields (a token, a folder): secrets go to the Keychain, the rest is written as is. */
function TokenForm({
  i,
  title,
  onClose,
  onDone,
}: {
  i: Integration;
  title: string;
  onClose(): void;
  onDone(): Promise<void>;
}) {
  const t = useT();
  // Editing a connected one: plain fields start as they are; a secret left empty keeps the stored one.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(i.fields.flatMap((f) => (f.value ? [[f.name, f.value]] : []))),
  );
  const [busy, setBusy] = useState(false);
  const ok = i.fields.every((f) => values[f.name]?.trim() || (i.connected && f.set));
  const save = async () => {
    setBusy(true);
    try {
      await client.call("integrations.connect", { id: i.id, values });
      await onDone();
    } catch (e) {
      notify(t("error.change", { error: errText(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!ok} loading={busy} onClick={() => void save()}>
            {i.connected ? t("common.save") : t("int.connect")}
          </Button>
        </>
      }
    >
      <div className="int__form">
        <p className="int__desc">{t("int.formNote")}</p>
        {i.fields.map((f) => (
          <Field
            key={f.name}
            label={f.label}
            hint={
              f.url ? (
                <a href={f.url} target="_blank" rel="noreferrer">
                  {t("int.whereToGet")}
                </a>
              ) : undefined
            }
          >
            {(id) => (
              <Input
                id={id}
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                placeholder={i.connected && f.set ? t("int.keepSecret") : f.placeholder}
                value={values[f.name] ?? ""}
                onChange={({ currentTarget: { value } }) => setValues((v) => ({ ...v, [f.name]: value }))}
              />
            )}
          </Field>
        ))}
      </div>
    </Dialog>
  );
}
