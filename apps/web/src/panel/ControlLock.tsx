import { AgentAvatar, Button, Icons } from "@apx/ui";

/**
 * Over a screen an agent is driving (a browser tab, the computer): who uses it and one button in the middle to take
 * control. The page stays visible behind it, dimmed.
 */
export function ControlLock({
  agent,
  blob,
  text,
  hint,
  action,
  busy = false,
  onTake,
  className,
}: {
  agent: string;
  blob?: string | undefined;
  /** "Roby is using this tab". */
  text: string;
  /** What taking control does to the agent. */
  hint: string;
  /** The button's words ("Take control"). */
  action: string;
  busy?: boolean;
  onTake(): void;
  className?: string;
}) {
  return (
    <div className={className ? `ctrllock ${className}` : "ctrllock"}>
      <div className="ctrllock__card">
        <AgentAvatar name={agent} blob={blob} size={36} animated />
        <p className="ctrllock__text">{text}</p>
        <Button size="sm" leadingIcon={<Icons.Lock size={14} />} loading={busy} title={hint} onClick={onTake}>
          {action}
        </Button>
        <p className="ctrllock__hint">{hint}</p>
      </div>
    </div>
  );
}
