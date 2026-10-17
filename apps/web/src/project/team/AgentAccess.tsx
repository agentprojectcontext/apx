// The agent editor's access pages: which tools and skills it may use (with a search), and what the owner granted
// it for good, narrowed to a condition or given an end date.
import {
  type Agent,
  type Autonomy,
  type Result,
  type RulePolicy,
  type SkillInfo,
  STRICT_APPROVAL,
  type ToolApproval,
} from "@apx/protocol";
import {
  Button,
  Checkbox,
  EmptyState,
  Field,
  Icons,
  Input,
  SearchField,
  Select,
  SettingRow,
  Skeleton,
  Switch,
  TagInput,
} from "@apx/ui";
import { useEffect, useState } from "react";
import { aheadLabel, shortWhen } from "../../common/format.ts";
import { listSkills } from "../../data/resources.ts";
import { useData } from "../../data/state.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";
import { type Draft, effectiveRule, type GrantChange, grantId } from "./editor/draft.ts";

type Catalog = Result<"agents.tools">["tools"];
const OTHER = "other";
const GROUP = {
  agents: "agent.access.group.agents",
  browser: "agent.access.group.browser",
  files: "agent.access.group.files",
  images: "agent.access.group.images",
  mcp: "agent.access.group.mcp",
  memory: "agent.access.group.memory",
  shell: "agent.access.group.shell",
  tasks: "agent.access.group.tasks",
  widgets: "agent.access.group.widgets",
  other: "agent.access.group.other",
} as const;

/** Tools grouped as the agent's list names them; a whole group is saved as its name. */
function groupsOf(catalog: Catalog): Array<[string, Catalog]> {
  const by = new Map<string, Catalog>();
  for (const t of catalog) by.set(t.group ?? OTHER, [...(by.get(t.group ?? OTHER) ?? []), t]);
  return [...by.entries()].sort(([a], [b]) => (a === OTHER ? 1 : b === OTHER ? -1 : a.localeCompare(b)));
}

/** Every name the list holds, groups spelled out into their tools. */
const expand = (list: string[], groups: Array<[string, Catalog]>) =>
  new Set(list.flatMap((n) => groups.find(([g]) => g === n && g !== OTHER)?.[1].map((t) => t.name) ?? [n]));

/** Back to the shortest list: a group whose every tool is picked is written as the group. */
function compact(picked: Set<string>, groups: Array<[string, Catalog]>, extra: string[]): string[] {
  const out: string[] = [];
  for (const [g, tools] of groups) {
    const free = tools.filter((t) => !t.kept);
    if (g !== OTHER && free.length && free.every((t) => picked.has(t.name))) out.push(g);
    else out.push(...free.filter((t) => picked.has(t.name)).map((t) => t.name));
  }
  return [...out, ...extra];
}

type ToolPolicy = RulePolicy | "granted" | "kept";

export function ToolsTab({
  value,
  onChange,
  catalog,
  draft,
  projectAutonomy,
  granted,
  onRules,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  catalog: Catalog | undefined;
  draft: Draft;
  projectAutonomy: Autonomy;
  granted: ToolApproval[];
  onRules(): void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  if (!catalog) return <Skeleton shape="block" height={200} />;
  const groups = groupsOf(catalog);
  const known = new Set([...catalog.map((x) => x.name), ...groups.map(([g]) => g)]);
  const isMcp = (n: string) => n.toLowerCase().startsWith("mcp_");
  // Names APX has no tool for (another app wrote them) restrict nothing; MCP names are patterns for later tools.
  const mcp = value.filter((n) => !known.has(n) && isMcp(n));
  const unknown = value.filter((n) => !known.has(n) && !isMcp(n));
  const picked = expand(
    value.filter((n) => known.has(n)),
    groups,
  );
  const limited = value.some((n) => known.has(n) || isMcp(n));
  const has = (name: string) => !limited || picked.has(name);
  const set = (next: Set<string>, nextMcp = mcp) => onChange(compact(next, groups, [...nextMcp, ...unknown]));
  // A grant with a condition still asks outside it, so only a whole grant counts here.
  const freely = new Set(granted.filter((g) => !g.condition).map((g) => g.tool));
  const policyOf = (x: Catalog[number]): ToolPolicy => {
    if (x.kept) return "kept";
    const rule = effectiveRule(draft, projectAutonomy, x.risk);
    if (!has(x.name) || rule === "off") return "off";
    return freely.has(x.name) && rule === "ask" ? "granted" : rule;
  };
  const query = q.trim().toLowerCase();
  const shown = groups
    .map(([g, tools]) => [g, tools.filter((x) => !query || x.name.includes(query) || g.includes(query))] as const)
    .filter(([, tools]) => tools.length);
  return (
    <div className="agentedit__rows">
      <SettingRow
        title={t("agent.access.allTools")}
        description={
          <>
            {t("agentedit.allToolsHint")}{" "}
            <button type="button" className="agentedit__link" onClick={onRules}>
              {t("agentedit.page.rules")}
            </button>
          </>
        }
      >
        <Switch
          aria-label={t("agent.access.allTools")}
          checked={!limited}
          // Limiting starts from everything picked, so nothing is lost until the owner unticks it.
          onCheckedChange={(all) =>
            onChange(all ? [] : [...groups.flatMap(([g, x]) => (g === OTHER ? x.map((y) => y.name) : [g])), ...unknown])
          }
        />
      </SettingRow>
      <ListSearch label={t("agentedit.searchTools")} value={q} onChange={setQ} />
      {shown.map(([g, tools]) => {
        const free = tools.filter((x) => !x.kept);
        const on = free.filter((x) => has(x.name)).length;
        return (
          <fieldset key={g} className={`agentaccess__group${limited ? "" : " is-all"}`}>
            <Checkbox
              label={g in GROUP ? t(GROUP[g as keyof typeof GROUP]) : <code>{g}</code>}
              checked={free.length > 0 && on === free.length}
              indeterminate={on > 0 && on < free.length}
              disabled={!limited || !free.length}
              onCheckedChange={(c) => {
                const next = new Set(picked);
                for (const x of free) c ? next.add(x.name) : next.delete(x.name);
                set(next);
              }}
            />
            <div className="agentaccess__tools">
              {tools.map((x) => {
                const p = policyOf(x);
                return (
                  <div key={x.name} className="agentaccess__tool">
                    <Checkbox
                      label={<code>{x.name}</code>}
                      checked={x.kept || has(x.name)}
                      disabled={x.kept || !limited}
                      onCheckedChange={(c) => {
                        const next = new Set(picked);
                        c ? next.add(x.name) : next.delete(x.name);
                        set(next);
                      }}
                    />
                    <span className={`agentedit__pol is-${p}`}>{t(`agentedit.pol.${p}` as MessageKey)}</span>
                  </div>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      {!shown.length && <p className="agentedit__empty">{t("agentedit.noToolMatch", { q })}</p>}
      {limited && (
        <TagInput
          label={t("agent.access.mcpTools")}
          placeholder="mcp_postiz_*"
          max={50}
          value={mcp}
          onValueChange={(v) => set(picked, v)}
        />
      )}
      {unknown.length > 0 && (
        <section className="agentedit__unknown">
          <div className="agentedit__unknownhead">
            <div>
              <div className="agentedit__grantstitle">{t("agentedit.unknownTools")}</div>
              <div className="agentedit__hint">{t("agentedit.unknownToolsHint")}</div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => onChange(value.filter((n) => !unknown.includes(n)))}>
              {t("agentedit.unknownToolsRemove")}
            </Button>
          </div>
          <div className="agentedit__chips">
            {unknown.map((n) => (
              <code key={n} className="agentedit__chip">
                {n}
              </code>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function SkillsTab({
  agent,
  value,
  onChange,
}: {
  agent: Agent;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const t = useT();
  const [skills, setSkills] = useState<SkillInfo[]>();
  const [q, setQ] = useState("");
  useEffect(() => {
    void listSkills(agent.project_id).then((s) => setSkills(s ?? []));
  }, [agent.project_id]);
  if (!skills) return <Skeleton shape="block" height={200} />;
  const wanted = new Set(value.map((s) => s.toLowerCase()));
  const limited = value.length > 0;
  const query = q.trim().toLowerCase();
  const shown = skills.filter(
    (s) => !query || s.name.toLowerCase().includes(query) || s.description?.toLowerCase().includes(query),
  );
  return (
    <div className="agentedit__rows">
      <SettingRow title={t("agent.access.allSkills")} description={t("agentedit.allSkillsHint")}>
        <Switch
          aria-label={t("agent.access.allSkills")}
          checked={!limited}
          onCheckedChange={(all) => onChange(all ? [] : skills.filter((s) => s.on).map((s) => s.name))}
        />
      </SettingRow>
      {skills.length ? (
        <>
          <ListSearch label={t("agentedit.searchSkills")} value={q} onChange={setQ} />
          <div className={`agentaccess__skills${limited ? "" : " is-all"}`}>
            {shown.map((s) => (
              <Checkbox
                key={`${s.scope}:${s.name}`}
                label={<code>{s.name}</code>}
                description={s.description}
                checked={!limited || wanted.has(s.name.toLowerCase())}
                disabled={!limited}
                onCheckedChange={(c) =>
                  onChange(c ? [...value, s.name] : value.filter((n) => n.toLowerCase() !== s.name.toLowerCase()))
                }
              />
            ))}
          </div>
          {!shown.length && <p className="agentedit__empty">{t("agentedit.noSkillMatch", { q })}</p>}
        </>
      ) : (
        <EmptyState size="sm" title={t("agent.access.noSkills")} />
      )}
    </div>
  );
}

const DAY = 86_400_000;
const EXPIRY: Array<{ value: string; label: MessageKey; days: number }> = [
  { value: "never", label: "agentedit.expiry.never", days: 0 },
  { value: "day", label: "agentedit.expiry.day", days: 1 },
  { value: "week", label: "agentedit.expiry.week", days: 7 },
  { value: "month", label: "agentedit.expiry.month", days: 30 },
];

export function GrantsPage({
  agent,
  grants,
  changes,
  onChange,
}: {
  agent: Agent;
  grants: ToolApproval[] | undefined;
  changes: Record<string, GrantChange>;
  /** Undefined drops the pending change. */
  onChange(id: string, change: GrantChange | undefined): void;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  if (!grants) return <Skeleton shape="block" height={160} />;
  const query = q.trim().toLowerCase();
  // Matches what the row shows: the tool, its server and the condition, a pending edit included.
  const matches = (g: ToolApproval) =>
    !query ||
    [g.tool, g.server, changes[grantId(g.key, g.agent_id)]?.condition ?? g.condition ?? ""].some((s) =>
      s.toLowerCase().includes(query),
    );
  const mine = grants.filter((g) => g.agent_id === agent.id && matches(g));
  const everyone = grants.filter((g) => !g.agent_id && matches(g));
  const section = (label: string, sub: string, rows: ToolApproval[]) => (
    <section className="agentedit__grants">
      <div className="agentedit__grantshead">
        <span className="agentedit__grantstitle">{label}</span>
        <span className="agentedit__hint">{sub}</span>
      </div>
      {rows.map((g) => (
        <GrantRow
          key={grantId(g.key, g.agent_id)}
          grant={g}
          change={changes[grantId(g.key, g.agent_id)]}
          onChange={(c) => onChange(grantId(g.key, g.agent_id), c)}
        />
      ))}
    </section>
  );
  return (
    <>
      {grants.length > 0 && <ListSearch label={t("agentedit.searchGrants")} value={q} onChange={setQ} />}
      {mine.length
        ? section(t("agentedit.forAgent"), t("agentedit.forAgentSub", { name: agent.name }), mine)
        : !query && (
            <EmptyState size="sm" title={t("agentedit.noGrants")}>
              {t("agentedit.noGrantsHint")}
            </EmptyState>
          )}
      {everyone.length > 0 && section(t("agentedit.forAll"), t("agentedit.forAllSub"), everyone)}
      {query && !mine.length && !everyone.length && (
        <p className="agentedit__empty">{t("agentedit.noGrantMatch", { q })}</p>
      )}
    </>
  );
}

/** The search over an access page's list; it stays on top while the list scrolls under it. */
function ListSearch({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <div className="agentedit__search">
      <SearchField
        size="sm"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </div>
  );
}

function GrantRow({
  grant: g,
  change,
  onChange,
}: {
  grant: ToolApproval;
  change: GrantChange | undefined;
  onChange(c: GrantChange | undefined): void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const thread = useData((s) => (g.from_thread ? s.threads[g.from_thread]?.title : undefined));
  const revoked = Boolean(change?.revoke);
  const condition = change?.condition ?? g.condition ?? "";
  const expires = change?.expires_at ?? g.expires_at ?? "";
  const soon = expires !== "" && Date.parse(expires) - Date.now() < 3 * DAY;
  const from = [
    g.from_thread ? (thread ? `“${thread}”` : t("agentedit.grantFromChat")) : t("agentedit.grantFromSettings"),
    g.granted_at ? shortWhen(g.granted_at) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const pending = change && !revoked;
  return (
    <div className={`agentedit__grant${revoked ? " is-revoked" : ""}`}>
      <div className="agentedit__granttext">
        <div className="agentedit__grantname">
          <code>{g.tool}</code>
          {g.server !== "apx" && <span className="agentedit__chip">{g.server}</span>}
          {condition && <span className="agentedit__chip">{t("agentedit.onlyFor", { condition })}</span>}
          {g.key.endsWith(STRICT_APPROVAL) && <span className="agentedit__hint">{t("agentedit.strict")}</span>}
        </div>
        <div className="agentedit__grantmeta">
          {g.from_thread ? <Icons.MessageCircle size={12} /> : <Icons.Settings size={12} />}
          <span>{revoked ? t("agentedit.revoked") : from}</span>
          <span>·</span>
          <span className={soon && !revoked ? "is-soon" : undefined}>
            {revoked || pending
              ? t("agentedit.unsavedShort")
              : expires
                ? t("agentedit.expiresIn", { when: aheadLabel(expires) })
                : t("agentedit.noExpiry")}
          </span>
        </div>
      </div>
      {!revoked && (
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {t("agentedit.limit")}
        </Button>
      )}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => (revoked ? onChange(undefined) : onChange({ revoke: true }))}
      >
        {revoked ? t("agentedit.undo") : t("agentedit.revoke")}
      </Button>
      {open && !revoked && (
        <div className="agentedit__grantedit">
          <Field label={t("agentedit.conditionLabel")} hint={t("agentedit.conditionHint")}>
            {(id) => (
              <Input
                id={id}
                maxLength={200}
                placeholder={t("agentedit.conditionPlaceholder")}
                value={condition}
                onChange={(e) => onChange({ ...change, condition: e.currentTarget.value })}
              />
            )}
          </Field>
          <Field label={t("agentedit.expiry")}>
            <Select
              label={t("agentedit.expiry")}
              value={null}
              placeholder={expires ? aheadLabel(expires) : t("agentedit.expiry.never")}
              onValueChange={(v) => {
                const days = EXPIRY.find((e) => e.value === v)?.days ?? 0;
                onChange({ ...change, expires_at: days ? new Date(Date.now() + days * DAY).toISOString() : "" });
              }}
              options={EXPIRY.map((e) => ({ value: e.value, label: t(e.label) }))}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
