import type { ExtensionInfo, McpServerStatus } from "@apx/protocol";
import { Badge, Button, Disclosure, DisclosureFacts, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import "@apx/ui/disclosure.css";
import { installArtifact } from "../data/artifacts.ts";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { createAgent } from "../data/team.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import type { Item } from "../resources/extensionItems.ts";
import { attempt, ExtensionRoutines, useAddRoutine } from "../resources/InstalledExtension.tsx";
import { ItemIcon } from "./ConnectHead.tsx";
import { authText, serverPlace } from "./itemText.ts";

// What it brings, as rows that open (like the connectors on a Claude plugin's page): each connection with its address,
// how it signs in and its tools; its skills, ready-made agents, routines, widgets and the app for a device.

/** Its server's state, when there is something to say (one not started yet starts when an agent first uses it). */
const STATUS: Partial<Record<McpServerStatus["status"], { tone: "brand" | "warning" | "danger"; key: MessageKey }>> = {
  ready: { tone: "brand", key: "mkt.conn.ready" },
  "needs-sign-in": { tone: "warning", key: "mkt.conn.signIn" },
  "needs-approval": { tone: "warning", key: "mkt.conn.approval" },
  error: { tone: "danger", key: "mkt.conn.error" },
};

/** "5 · list_companies, get_deal…": how many tools, and their names once it has started. */
const toolsText = (s: McpServerStatus) =>
  s.tools ? [String(s.tools), s.tool_names.join(", ")].filter(Boolean).join(" · ") : undefined;

function Connection({ item, server, name }: { item: Item; server?: McpServerStatus | undefined; name: string }) {
  const t = useT();
  const st = server ? STATUS[server.status] : undefined;
  return (
    <Disclosure
      defaultOpen
      icon={<ItemIcon item={item} size={24} />}
      title={name}
      description={t("mkt.part.connectionOne")}
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
          [t("mkt.conn.address"), server ? serverPlace(server, t) : undefined],
          [t("mkt.conn.auth"), authText(item, t)],
          [t("mkt.conn.tools"), server ? toolsText(server) : undefined],
        ]}
      />
      {!server && (
        <p className="mkt-part__note">
          {t(item.integration || item.origin === "included" ? "mkt.conn.laterConnect" : "mkt.conn.later")}
        </p>
      )}
    </Disclosure>
  );
}

function Part({
  icon,
  title,
  kind,
  children,
}: {
  icon: ReactNode;
  title: string;
  kind: MessageKey;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <Disclosure icon={icon} title={title} description={t(kind)}>
      {children}
    </Disclosure>
  );
}

function Agents({ e }: { e: ExtensionInfo }) {
  const t = useT();
  const add = async (a: ExtensionInfo["agents"][number]) => {
    const made = await createAgent({ name: a.name, description: a.description, prompt: a.prompt });
    if (made) notify(t("mkt.agentAdded", { name: made.name }), "info");
  };
  return (
    <>
      {e.agents.map((a) => (
        <Part key={a.id} icon={<Icons.Bot size={14} />} title={a.name} kind="mkt.part.agentOne">
          {a.description && <p className="mkt-part__note">{a.description}</p>}
          <div>
            <Button size="sm" variant="secondary" leadingIcon={<Icons.Plus size={14} />} onClick={() => void add(a)}>
              {t("mkt.addAgent")}
            </Button>
          </div>
        </Part>
      ))}
    </>
  );
}

function Apps({ e }: { e: ExtensionInfo }) {
  const t = useT();
  const add = async (file: string) => {
    const bundle = await attempt(() => client.call("extensions.app_bundle", { id: e.id, file }), t);
    if (bundle) await installArtifact(bundle, undefined, true);
  };
  return (
    <>
      {e.apps.map((a) => (
        <Part
          key={a.file}
          icon={<Icons.LayoutGrid size={14} />}
          title={
            a.name ??
            a.file
              .split("/")
              .at(-1)
              ?.replace(/\.apxart$/i, "") ??
            a.file
          }
          kind="mkt.part.appOne"
        >
          <div>
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={<Icons.Plus size={14} />}
              onClick={() => void add(a.file)}
            >
              {t("mkt.addApp")}
            </Button>
          </div>
        </Part>
      ))}
    </>
  );
}

const PLATFORM: Record<NonNullable<ExtensionInfo["companion"]>["platform"], string> = {
  android: "Android",
  "android-tv": "Android TV",
  ios: "iPhone",
  macos: "Mac",
  windows: "Windows",
  linux: "Linux",
};

export function ItemParts({ item, servers }: { item: Item; servers: McpServerStatus[] }) {
  const t = useT();
  const addRoutine = useAddRoutine();
  const e = item.ext;
  const own = (n: string) => servers.find((s) => s.scope === "global" && s.name === n);
  const rows: ReactNode[] = [];
  if (e) {
    // One row per server it runs; one that names it after itself reads as the extension's own connection.
    for (const n of e.mcp)
      rows.push(
        <Connection
          key={n}
          item={item}
          server={own(n)}
          name={e.mcp.length > 1 ? n.replace(`${e.id}-`, "") : item.name}
        />,
      );
  } else if (item.integration || item.server || item.brings.includes("accounts") || item.brings.includes("tools"))
    rows.push(<Connection key="conn" item={item} server={item.server} name={item.name} />);
  if (e?.skills.length || (!e && item.brings.includes("skills")))
    rows.push(
      <Part key="skills" icon={<Icons.Sparkles size={14} />} title={t("mkt.part.skillsTitle")} kind="mkt.part.skillOne">
        <p className="mkt-part__note">
          {e?.skills.length ? t("mkt.part.skillsN", { n: e.skills.length }) : t("mkt.part.skillsSome")}
        </p>
      </Part>,
    );
  if (e?.agents.length) rows.push(<Agents key="agents" e={e} />);
  if (!e && item.brings.includes("agents"))
    rows.push(
      <Part key="agents" icon={<Icons.Bot size={14} />} title={t("mkt.part.agentsTitle")} kind="mkt.part.agentOne">
        <p className="mkt-part__note">{t("mkt.part.agentsLater")}</p>
      </Part>,
    );
  if (e?.routines.length)
    rows.push(
      <Part
        key="routines"
        icon={<Icons.Clock size={14} />}
        title={t("mkt.part.routinesTitle", { n: e.routines.length })}
        kind="mkt.part.routineOne"
      >
        <ExtensionRoutines e={e} onAdd={addRoutine} bare />
      </Part>,
    );
  if (e?.apps.length) rows.push(<Apps key="apps" e={e} />);
  if (e?.companion) {
    const c = e.companion;
    rows.push(
      <Part key="device" icon={<Icons.Smartphone size={14} />} title={c.name} kind="mkt.part.deviceOne">
        <DisclosureFacts rows={[[t("mkt.device.on"), PLATFORM[c.platform]]]} />
        {c.steps.length > 0 && (
          <ol className="mkt-part__steps">
            {c.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )}
      </Part>,
    );
  } else if (!e && item.brings.includes("devices"))
    rows.push(
      <Part
        key="device"
        icon={<Icons.Smartphone size={14} />}
        title={t("mkt.part.deviceTitle")}
        kind="mkt.part.deviceOne"
      >
        <p className="mkt-part__note">{t("mkt.part.deviceLater")}</p>
      </Part>,
    );
  if (!rows.length) return null;
  return (
    <section className="mkt-page__sec">
      <h4>{t("extx.sec.brings")}</h4>
      <div className="mkt-parts">{rows}</div>
    </section>
  );
}
