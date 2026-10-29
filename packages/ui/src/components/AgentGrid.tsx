import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { useState } from "react";
import { cx } from "../cx";
import { AgentAvatar } from "./AgentAvatar";

export interface AgentGridOption {
  id: string;
  name: string;
  /** What it does ("Marketing & growth"), under the name. */
  role?: string;
  blob?: string;
}

export interface AgentGridProps {
  agents: readonly AgentGridOption[];
  value: string | null;
  onValueChange: (id: string) => void;
  /** Accessible name of the group. */
  label: string;
  /** Cards shown before "show all"; the chosen one is always among them. Default 6. */
  limit?: number;
  /** The button that shows the rest, given how many there are in all. */
  moreLabel?: (count: number) => string;
  lessLabel?: string;
  className?: string;
}

/**
 * Agents to choose one from, as cards in two columns: avatar, name and role, the chosen one outlined. With more than
 * `limit`, the rest wait behind a "show all" button. Arrows move the choice, as in any radio group.
 */
export function AgentGrid({
  agents,
  value,
  onValueChange,
  label,
  limit = 6,
  moreLabel = (n) => `Show all ${n}`,
  lessLabel = "Show fewer",
  className,
}: AgentGridProps) {
  const [all, setAll] = useState(false);
  const chosen = agents.findIndex((a) => a.id === value);
  const extra = agents.length > limit;
  let shown = all || !extra ? agents : agents.slice(0, limit);
  // The chosen agent stays in sight even when it is past the first cards.
  if (!all && extra && chosen >= limit) shown = [...agents.slice(0, limit - 1), agents[chosen] as AgentGridOption];
  return (
    <div className={cx("apx-agentgrid", className)}>
      <RadioGroup
        value={value ?? ""}
        onValueChange={(v: string) => onValueChange(v)}
        aria-label={label}
        className="apx-agentgrid__cards"
      >
        {shown.map((a) => (
          <Radio.Root
            key={a.id}
            value={a.id}
            nativeButton
            render={<button type="button" />}
            className={cx("apx-agentgrid__card", a.id === value && "is-selected")}
          >
            <AgentAvatar name={a.name} blob={a.blob} size={24} animated={false} />
            <span className="apx-agentgrid__text">
              <span className="apx-agentgrid__name">{a.name}</span>
              {a.role && <span className="apx-agentgrid__role">{a.role}</span>}
            </span>
          </Radio.Root>
        ))}
      </RadioGroup>
      {extra && (
        <button type="button" className="apx-agentgrid__more" onClick={() => setAll(!all)}>
          {all ? lessLabel : moreLabel(agents.length)}
        </button>
      )}
    </div>
  );
}
