import type { ExtensionInfo, McpServerStatus } from "@apx/protocol";
import {
  Badge,
  Button,
  Disclosure,
  DisclosureFacts,
  IconButton,
  Icons,
  IntegrationIcon,
  SummaryCard,
  SummaryItem,
  SummaryNote,
} from "@apx/ui";
import type { ReactNode } from "react";
import "@apx/ui/disclosure.css";
import "@apx/ui/summary.css";
import { installArtifact } from "../data/artifacts.ts";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { addExtensionAgent } from "../data/team.ts";
import { type MessageKey, useLanguage, useT } from "../i18n/index.ts";
import type { Item } from "../resources/extensionItems.ts";
import { attempt, ExtensionRoutines, useAddRoutine } from "../resources/InstalledExtension.tsx";
import { toolsLine } from "./about.ts";
import { type Brings, bringsOf, type Connector } from "./brings.ts";
import { AUTH_TEXT } from "./itemText.ts";

// What an extension brings, the same on its page before and after adding it (as a Claude plugin's page shows its
// connectors and skills): each connector with its address, how it signs in and its tools; its skills and agents with
// what each does; routines, widgets, a device's app; and what it will ask for. Unknown facts have no row.

/** Its server's state, when there is something to say (one not started yet starts when an agent first uses it). */
const STATUS: Partial<Record<McpServerStatus["status"], { tone: "brand" | "warning" | "danger"; key: MessageKey }>> = {
  ready: { tone: "brand", key: "mkt.conn.ready" },
  "needs-sign-in": { tone: "warning", key: "mkt.conn.signIn" },
  "needs-approval": { tone: "warning", key: "mkt.conn.approval" },
  error: { tone: "danger", key: "mkt.conn.error" },
};

const PLATFORM: Record<string, string> = {
  android: "Android",
  "android-tv": "Android TV",
  ios: "iPhone",
  macos: "Mac",
  windows: "Windows",
  linux: "Linux",
};

function Address({ c }: { c: Connector }) {
  const t = useT();
  if (c.address)
    return (
      <span className="mkt-addr">
        <code>{c.address}</code>
        <IconButton
          size="sm"
          variant="ghost"
          label={t("mkt.conn.copy")}
          icon={<Icons.Copy size={13} />}
          onClick={() =>
            void navigator.clipboard.writeText(c.address ?? "").then(() => notify(t("mkt.conn.copied"), "info"))
          }
        />
      </span>
    );
  if (c.ownerAddress) return <>{t("mkt.conn.yourAddress")}</>;
  return c.runsHere ? <>{t("mkt.conn.here")}</> : null;
}

/** "9  list customers, get a payment…": how many and which, or when they will be known. */
function Tools({ c, item }: { c: Connector; item: Item }) {
  const t = useT();
  if (c.tools?.names.length)
    return (
      <span className="mkt-tools">
        <b>{c.tools.names.length}</b>
        <span className="mkt-tools__list">{toolsLine(c.tools.names, t, 12)}</span>
      </span>
    );
  // Before it signs in, only the service knows them: said once, plainly.
  return (
    <span className="mkt-part__note">{t(item.label === "own" ? "mkt.conn.toolsOwn" : "mkt.conn.toolsLater")}</span>
  );
}

function ConnectorRow({ item, c, open }: { item: Item; c: Connector; open: boolean }) {
  const t = useT();
  const st = c.server ? STATUS[c.server.status] : undefined;
  return (
    <Disclosure
      defaultOpen={open}
      icon={c.mark ? <IntegrationIcon id={c.mark} name={c.name} size={24} /> : undefined}
      className={c.mark ? undefined : "mkt-part__connector--unmarked"}
      title={c.name}
      trailing={
        st ? (
          <Badge tone={st.tone} dot>
            {t(st.key)}
          </Badge>
        ) : undefined
      }
    >
      <DisclosureFacts
        rows={[
          [t("mkt.conn.address"), <Address key="a" c={c} />],
          [t("mkt.conn.auth"), c.auth ? t(AUTH_TEXT[c.auth]) : undefined],
          [t("mkt.conn.tools"), <Tools key="t" c={c} item={item} />],
        ]}
      />
    </Disclosure>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mkt-page__sec">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Skills({ b }: { b: Brings }) {
  const t = useT();
  if (!b.skills) return <p className="mkt-part__note">{t("mkt.skills.later")}</p>;
  if (!b.skills.length) return <p className="mkt-part__note">{t("mkt.skills.none")}</p>;
  return (
    <SummaryCard variant="outline">
      {b.skills.map((s) => (
        <SummaryItem key={s.name} icon={<Icons.BookOpen size={13} />} title={s.name}>
          {s.line}
        </SummaryItem>
      ))}
    </SummaryCard>
  );
}

function Agents({ b, e, onChanged }: { b: Brings; e?: ExtensionInfo | undefined; onChanged(): Promise<void> }) {
  const t = useT();
  const add = async (ext: ExtensionInfo, a: ExtensionInfo["agents"][number]) => {
    const made = await addExtensionAgent(ext.id, a.id);
    if (made) notify(t("mkt.agentAdded", { name: made.name }), "info");
    await onChanged();
  };
  const added = new Set((e?.added_agents ?? []).map((x) => x.agent));
  return (
    <SummaryCard variant="outline">
      {b.agents.map((a) => {
        const full = e?.agents.find((x) => x.name === a.name);
        return (
          <SummaryItem key={a.name} icon={<Icons.Bot size={13} />} title={a.name}>
            {a.line && <span className="mkt-bring__line">{a.line}</span>}
            {full && e && (
              <span className="mkt-bring__act">
                {added.has(full.id) ? (
                  <Button size="sm" variant="secondary" disabled leadingIcon={<Icons.Check size={14} />}>
                    {t("mkt.agentInTeam")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<Icons.Plus size={14} />}
                    onClick={() => void add(e, full)}
                  >
                    {t("mkt.addAgent")}
                  </Button>
                )}
              </span>
            )}
          </SummaryItem>
        );
      })}
    </SummaryCard>
  );
}

function Widgets({ b, e }: { b: Brings; e?: ExtensionInfo | undefined }) {
  const t = useT();
  const add = async (ext: ExtensionInfo, file: string) => {
    const bundle = await attempt(() => client.call("extensions.app_bundle", { id: ext.id, file }), t);
    if (bundle) await installArtifact(bundle, undefined, true);
  };
  if (!e?.apps.length)
    return (
      <SummaryCard variant="outline">
        <SummaryItem
          icon={<Icons.LayoutGrid size={13} />}
          title={t(b.widgets === 1 ? "box.widgets" : "mkt.widgetsN", { n: b.widgets })}
        >
          {t("box.widgetsLine")}
        </SummaryItem>
      </SummaryCard>
    );
  return (
    <SummaryCard variant="outline">
      {e.apps.map((a) => (
        <SummaryItem
          key={a.file}
          icon={<Icons.LayoutGrid size={13} />}
          title={
            a.name ??
            a.file
              .split("/")
              .at(-1)
              ?.replace(/\.apxart$/i, "") ??
            a.file
          }
        >
          <span className="mkt-bring__act">
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Icons.Plus size={14} />}
              onClick={() => void add(e, a.file)}
            >
              {t("mkt.addApp")}
            </Button>
          </span>
        </SummaryItem>
      ))}
    </SummaryCard>
  );
}

export function ItemBrings({
  item,
  servers,
  onChanged,
}: {
  item: Item;
  servers: McpServerStatus[];
  /** Something changed (an agent added): read it again. */
  onChanged(): Promise<void>;
}) {
  const t = useT();
  const lang = useLanguage();
  const addRoutine = useAddRoutine();
  const b = bringsOf(item, servers, lang);
  const e = item.ext;
  // Skills are said for an extension even when it has none, as Claude's pages say it; an account or channel has none.
  const extension = Boolean(e || item.entry);
  // What it asks for matters until it works.
  const asks =
    item.state === "available" || item.state === "off" || item.attention === "keys" || item.attention === "settings";
  // Descriptive catalog copy is not an inspected list of package contents.
  if (!b.known && !b.connectors.length)
    return (
      <section className="mkt-brings" aria-label={t("extx.sec.brings")}>
        <h3 className="mkt-brings__title">{t("extx.sec.brings")}</h3>
        <SummaryNote icon={<Icons.Info size={14} />}>{t("box.bringsUnknown")}</SummaryNote>
      </section>
    );
  const blocks: ReactNode[] = [];
  if (b.connectors.length)
    blocks.push(
      <Block key="conn" title={t(b.connectors.length === 1 ? "mkt.sec.connector" : "mkt.sec.connectors")}>
        <div className="mkt-parts">
          {b.connectors.map((c) => (
            <ConnectorRow key={c.key} item={item} c={c} open={b.connectors.length <= 3} />
          ))}
        </div>
      </Block>,
    );
  if (extension)
    blocks.push(
      <Block key="skills" title={t("mkt.sec.skills")}>
        <Skills b={b} />
      </Block>,
    );
  if (b.agents.length)
    blocks.push(
      <Block key="agents" title={t("mkt.sec.agents")}>
        <Agents b={b} e={e} onChanged={onChanged} />
      </Block>,
    );
  if (b.routines.length)
    blocks.push(
      <Block key="routines" title={t("mkt.sec.routines")}>
        {e?.routines.length ? (
          <ExtensionRoutines e={e} onAdd={addRoutine} bare />
        ) : (
          <SummaryCard variant="outline">
            {b.routines.map((r) => (
              <SummaryItem key={r} icon={<Icons.Clock size={13} />} title={r} />
            ))}
          </SummaryCard>
        )}
      </Block>,
    );
  if (b.widgets)
    blocks.push(
      <Block key="widgets" title={t("mkt.sec.widgets")}>
        <Widgets b={b} e={e} />
      </Block>,
    );
  if (b.device) {
    const steps = e?.companion?.steps ?? [];
    blocks.push(
      <Block key="device" title={t("mkt.sec.device")}>
        <SummaryCard variant="outline">
          <SummaryItem icon={<Icons.Smartphone size={13} />} title={b.device.name}>
            <span className="mkt-bring__line">
              {t("mkt.device.for", { platform: PLATFORM[b.device.platform] ?? b.device.platform })}
            </span>
            {steps.length > 0 && (
              <ol className="mkt-part__steps">
                {steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            )}
          </SummaryItem>
        </SummaryCard>
      </Block>,
    );
  }
  if (asks && (b.keys.length || b.settings.length))
    blocks.push(
      <Block key="asks" title={t("mkt.sec.asks")}>
        <SummaryCard variant="outline">
          {b.keys.map((k) => (
            <SummaryItem key={`k:${k}`} icon={<Icons.KeyRound size={13} />} title={k}>
              {t("mkt.asks.key")}
            </SummaryItem>
          ))}
          {b.settings.map((s) => (
            <SummaryItem key={`s:${s}`} icon={<Icons.Settings size={13} />} title={s}>
              {t("mkt.asks.setting")}
            </SummaryItem>
          ))}
        </SummaryCard>
      </Block>,
    );
  if (!blocks.length) return null;
  return (
    <section className="mkt-brings" aria-label={t("extx.sec.brings")}>
      <h3 className="mkt-brings__title">{t("extx.sec.brings")}</h3>
      {blocks}
    </section>
  );
}
