import { CheckCircle2, CircleDot, CircleSlash, XCircle, AlertCircle } from "lucide-react";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneText, toneTint } from "../../lib/tone";
import type { CommitmentEntry, CommitmentState } from "../../lib/api/commitments";

// How each commitment state looks, in one place — the same reasoning as
// tasks/taskStatus.tsx. "overdue" is not a stored state but it is the one the
// eye has to catch first, so it renders as its own face.
type Face = { color: string; tint: string; Icon: typeof CircleDot };

const FACE: Record<CommitmentState | "overdue", Face> = {
  open:     { color: toneText.amber,          tint: toneTint.amber,      Icon: CircleDot },
  overdue:  { color: toneText.red,            tint: toneTint.red,        Icon: AlertCircle },
  kept:     { color: toneText.emerald,        tint: toneTint.emerald,    Icon: CheckCircle2 },
  missed:   { color: toneText.red,            tint: toneTint.red,        Icon: XCircle },
  dropped:  { color: "text-muted-foreground", tint: "bg-muted",          Icon: CircleSlash },
};

/** Background+foreground for the little square that carries the icon in lists. */
export function commitmentTint(face: CommitmentState | "overdue"): string {
  return FACE[face].tint;
}

/** Past its date and still owed. */
export function isOverdue(c: Pick<CommitmentEntry, "state" | "due">): boolean {
  return c.state === "open" && !!c.due && String(c.due) < new Date().toISOString();
}

export function commitmentFace(c: Pick<CommitmentEntry, "state" | "due">): CommitmentState | "overdue" {
  return isOverdue(c) ? "overdue" : c.state;
}

export function CommitmentIcon({ face, className }: { face: CommitmentState | "overdue"; className?: string }) {
  const f = FACE[face];
  return <f.Icon className={cn("size-4", f.color, className)} />;
}

export function CommitmentBadge({ face }: { face: CommitmentState | "overdue" }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border border-current/30 px-1.5 py-0.5 text-[10px] font-medium", FACE[face].color)}>
      <CommitmentIcon face={face} className="size-3" />
      {t(`project.commitments.face.${face}` as never)}
    </span>
  );
}
