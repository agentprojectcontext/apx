// The agent editor's access tabs: which tools and skills it may use, and the tools the owner let it use for good.
import { type Agent, type Result, type SkillInfo, STRICT_APPROVAL, type ToolApproval } from "@apx/protocol";
import { Button, Checkbox, EmptyState, Skeleton, Switch, TagInput } from "@apx/ui";
import { useEffect, useState } from "react";
import { listApprovals, listSkills, revokeApproval } from "../../data/resources.ts";
import { agentToolCatalog } from "../../data/team.ts";
import { useT } from "../../i18n/index.ts";

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

export function ToolsTab({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  const [catalog, setCatalog] = useState<Catalog>();
  useEffect(() => {
    void agentToolCatalog().then((c) => c && setCatalog(c));
  }, []);
  if (!catalog) return <Skeleton shape="block" height={200} />;
  const groups = groupsOf(catalog);
  const known = new Set([...catalog.map((x) => x.name), ...groups.map(([g]) => g)]);
  const extra = value.filter((n) => !known.has(n));
  const picked = expand(
    value.filter((n) => known.has(n)),
    groups,
  );
  const limited = value.length > 0;
  const set = (next: Set<string>, nextExtra = extra) => onChange(compact(next, groups, nextExtra));
  return (
    <div className="taskform">
      <Switch
        label={t("agent.access.allTools")}
        description={t("agent.access.allToolsHint")}
        checked={!limited}
        // Limiting starts from everything picked, so nothing is lost until the owner unticks it.
        onCheckedChange={(all) =>
          onChange(all ? [] : groups.flatMap(([g, x]) => (g === OTHER ? x.map((y) => y.name) : [g])))
        }
      />
      {limited && (
        <>
          {groups.map(([g, tools]) => {
            const free = tools.filter((x) => !x.kept);
            const on = free.filter((x) => picked.has(x.name)).length;
            return (
              <fieldset key={g} className="agentaccess__group">
                <Checkbox
                  label={g in GROUP ? t(GROUP[g as keyof typeof GROUP]) : <code>{g}</code>}
                  checked={free.length > 0 && on === free.length}
                  indeterminate={on > 0 && on < free.length}
                  disabled={!free.length}
                  onCheckedChange={(c) => {
                    const next = new Set(picked);
                    for (const x of free) c ? next.add(x.name) : next.delete(x.name);
                    set(next);
                  }}
                />
                <div className="agentaccess__tools">
                  {tools.map((x) => (
                    <Checkbox
                      key={x.name}
                      label={<code>{x.name}</code>}
                      {...(x.kept ? { description: t("agent.access.kept") } : {})}
                      checked={x.kept || picked.has(x.name)}
                      disabled={x.kept}
                      onCheckedChange={(c) => {
                        const next = new Set(picked);
                        c ? next.add(x.name) : next.delete(x.name);
                        set(next);
                      }}
                    />
                  ))}
                </div>
              </fieldset>
            );
          })}
          <TagInput
            label={t("agent.access.mcpTools")}
            placeholder="mcp_postiz_*"
            max={50}
            value={extra}
            onValueChange={(v) => set(picked, v)}
          />
        </>
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
  useEffect(() => {
    void listSkills(agent.project_id).then((s) => setSkills(s ?? []));
  }, [agent.project_id]);
  if (!skills) return <Skeleton shape="block" height={200} />;
  const wanted = new Set(value.map((s) => s.toLowerCase()));
  const limited = value.length > 0;
  return (
    <div className="taskform">
      <Switch
        label={t("agent.access.allSkills")}
        description={t("agent.access.allSkillsHint")}
        checked={!limited}
        onCheckedChange={(all) => onChange(all ? [] : skills.filter((s) => s.on).map((s) => s.name))}
      />
      {limited &&
        (skills.length ? (
          <div className="agentaccess__tools">
            {skills.map((s) => (
              <Checkbox
                key={`${s.scope}:${s.name}`}
                label={<code>{s.name}</code>}
                description={s.description}
                checked={wanted.has(s.name.toLowerCase())}
                onCheckedChange={(c) =>
                  onChange(c ? [...value, s.name] : value.filter((n) => n.toLowerCase() !== s.name.toLowerCase()))
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState size="sm" title={t("agent.access.noSkills")} />
        ))}
    </div>
  );
}

export function PermissionsTab({ agent }: { agent: Agent }) {
  const t = useT();
  const [grants, setGrants] = useState<ToolApproval[]>();
  const load = () => void listApprovals().then((g) => setGrants((g ?? []).filter((x) => x.scope === "always")));
  useEffect(load, []);
  if (!grants) return <Skeleton shape="block" height={160} />;
  const mine = grants.filter((g) => g.agent_id === agent.id);
  const everyone = grants.filter((g) => !g.agent_id);
  const row = (g: ToolApproval) => (
    <li key={`${g.key}:${g.agent_id ?? ""}`} className="agentaccess__grant">
      <code>{g.tool}</code>
      <span className="agentaccess__server">
        {g.server === "apx" ? "APX" : g.server}
        {g.key.endsWith(STRICT_APPROVAL) && ` · ${t("agent.access.strict")}`}
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void revokeApproval(g.key, undefined, g.agent_id).then(load)}
      >
        {t("agent.access.revoke")}
      </Button>
    </li>
  );
  return (
    <div className="taskform">
      <p className="agentaccess__note">{t("agent.access.grantsHint")}</p>
      {mine.length ? (
        <ul className="agentaccess__grants">{mine.map(row)}</ul>
      ) : (
        <EmptyState size="sm" title={t("agent.access.noGrants")}>
          {t("agent.access.noGrantsHint")}
        </EmptyState>
      )}
      {everyone.length > 0 && (
        <>
          <p className="agentaccess__note">{t("agent.access.everyone")}</p>
          <ul className="agentaccess__grants">{everyone.map(row)}</ul>
        </>
      )}
    </div>
  );
}
