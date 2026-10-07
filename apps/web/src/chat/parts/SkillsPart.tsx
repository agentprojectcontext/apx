import type { Part, SkillInfo } from "@apx/protocol";
import { Icons, Popover, Tag, Tooltip } from "@apx/ui";
import { useEffect, useState } from "react";
import { listSkills } from "../../data/resources.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";
import { sourceTag } from "../../resources/labels.ts";
import { go } from "../../shell/nav.ts";

type SkillsPart = Extract<Part, { type: "skills" }>;
type Kind = "loaded" | "strong" | "hinted" | "considered";

/** Near misses worth showing: the faintest resemblance that still says something about the message. */
const CONSIDERED_MIN_SIM = 0.15;
const MAX_CONSIDERED = 3;

const LABEL: Record<Kind, (name: string) => string> = {
  loaded: (n) => n,
  strong: (n) => n,
  hinted: (n) => `${n}?`,
  considered: (n) => `~${n}`,
};
const WHY: Record<Kind, MessageKey> = {
  loaded: "skills.trace.loaded",
  strong: "skills.trace.strong",
  hinted: "skills.trace.hinted",
  considered: "skills.trace.considered",
};

/**
 * The skills of this turn, as chips over the answer: given whole (asked with /name), recommended (blue when very
 * close), or only weighed. Each one
 * opens a card saying what it cost the context, with a link to the skill.
 */
export function SkillsPart({ part, projectId }: { part: SkillsPart; projectId: string | undefined }) {
  const t = useT();
  const strong = part.strong ?? [];
  const injected = new Set([...part.loaded, ...strong, ...part.hinted]);
  const considered = part.scored
    .filter((s) => !injected.has(s.name) && s.sim >= CONSIDERED_MIN_SIM)
    .slice(0, MAX_CONSIDERED)
    .map((s) => s.name);
  const chips: Array<{ name: string; kind: Kind }> = [
    ...part.loaded.map((name) => ({ name, kind: "loaded" as const })),
    ...strong.map((name) => ({ name, kind: "strong" as const })),
    ...part.hinted.map((name) => ({ name, kind: "hinted" as const })),
    ...considered.map((name) => ({ name, kind: "considered" as const })),
  ];
  if (!chips.length) return null;
  // No engine: the owner named the skill with "/name".
  const title = part.engine
    ? t("skills.trace.title", { engine: part.engine })
    : t("skills.trace.asked", { name: part.loaded[0] ?? "" });
  return (
    <div className="turn__skills">
      <Tooltip content={title}>
        <span className="turn__skillsicon" role="img" aria-label={title}>
          <Icons.Sparkles size={11} />
        </span>
      </Tooltip>
      {chips.map((c) => (
        <Popover
          key={`${c.kind}:${c.name}`}
          width={300}
          label={c.name}
          trigger={
            <button type="button" className={`skillchip is-${c.kind}`}>
              {LABEL[c.kind](c.name)}
            </button>
          }
        >
          <SkillCard
            name={c.name}
            kind={c.kind}
            sim={part.scored.find((s) => s.name === c.name)?.sim}
            projectId={projectId}
          />
        </Popover>
      ))}
    </div>
  );
}

/** Mounted when the card opens, so the skills list is read on the first click, not for every message painted. */
function SkillCard({
  name,
  kind,
  sim,
  projectId,
}: {
  name: string;
  kind: Kind;
  sim: number | undefined;
  projectId: string | undefined;
}) {
  const t = useT();
  const [skill, setSkill] = useState<SkillInfo | null>();
  useEffect(() => {
    let live = true;
    void listSkills(projectId).then((all) => live && setSkill(all?.find((s) => s.name === name) ?? null));
    return () => {
      live = false;
    };
  }, [name, projectId]);
  const tag = skill && sourceTag(skill, t);
  return (
    <div className="skillcard">
      <div className="skillcard__head">
        <code className="skillcard__name">{name}</code>
        {tag && <Tag>{tag}</Tag>}
      </div>
      <p className="skillcard__why">
        {t(WHY[kind])}
        {sim !== undefined && ` · ${t("skills.trace.sim", { sim: sim.toFixed(2) })}`}
      </p>
      <p className="skillcard__desc">
        {skill === undefined ? "…" : skill?.description || t("skills.trace.noDescription")}
      </p>
      <button
        type="button"
        className="skillcard__open"
        onClick={() => {
          go.resources("skills");
          go.focus(`skill:${name}`);
        }}
      >
        {t("skills.trace.open")} <Icons.ExternalLink size={12} />
      </button>
    </div>
  );
}
