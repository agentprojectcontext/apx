import type { ComputerMemoryRefusal, ComputerNeed } from "@apx/protocol";
import { CopyButton } from "../chat/MessageActions.tsx";
import { useLanguage, useT } from "../i18n/index.ts";

/** A step the owner takes once on this machine: what to do, the command to copy, and a retry once it is done. */
function ComputerNeeds(props: { needs: ComputerNeed; busy?: boolean | undefined; onRetry?: (() => void) | undefined }) {
  const t = useT();
  const { reason, command } = props.needs;
  return (
    <div className="computer__needs" role="alert">
      <strong>{t("computer.needs.title")}</strong>
      <p>{t(reason === "qemu" && !command ? "computer.needs.qemuAny" : `computer.needs.${reason}`)}</p>
      {command && (
        <div className="computer__command">
          <code>{command}</code>
          <CopyButton text={command} />
        </div>
      )}
      {props.onRetry && (
        <button type="button" className="computer__button is-primary" disabled={props.busy} onClick={props.onRetry}>
          {t("computer.needs.retry")}
        </button>
      )}
    </div>
  );
}

/**
 * Why the computer is not on, above its desktop or setup: a step left on this machine, or a refused start in the
 * owner's language, with the smaller memory that would start it now when there is one.
 */
export function ComputerError(props: {
  error: string;
  /** What the owner still has to do on this machine: shown instead of the error it causes. */
  needs?: ComputerNeed | undefined;
  onRetry?(): void;
  refusal?: ComputerMemoryRefusal | undefined;
  busy?: boolean;
  onLower?(gib: number): void;
  /** Start it anyway, past the host's reserve: offered when only the reserve is missing. */
  onAnyway?(): void;
}) {
  const t = useT();
  const lang = useLanguage();
  const { refusal, onLower, onAnyway } = props;
  const n = (v: number) => new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(v);
  if (props.needs) return <ComputerNeeds needs={props.needs} busy={props.busy} onRetry={props.onRetry} />;
  if (!refusal && !props.error) return null;
  return (
    <div className="computer__error" role="alert">
      {refusal
        ? t("computer.noMemory", { free: n(refusal.free_gib), vm: n(refusal.vm_gib), reserve: n(refusal.reserve_gib) })
        : props.error}
      {refusal?.fits_gib !== undefined && onLower && (
        <button
          type="button"
          className="computer__button is-primary"
          disabled={props.busy}
          onClick={() => refusal.fits_gib !== undefined && onLower(refusal.fits_gib)}
        >
          {t("computer.lowerMemory", { gib: n(refusal.fits_gib) })}
        </button>
      )}
      {refusal?.anyway && onAnyway && (
        <button type="button" className="computer__button" disabled={props.busy} onClick={onAnyway}>
          {t("computer.startAnyway")}
        </button>
      )}
    </div>
  );
}
