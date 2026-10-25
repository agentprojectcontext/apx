import type { ComputerMemoryRefusal } from "@apx/protocol";
import { useLanguage, useT } from "../i18n/index.ts";

/**
 * Why the computer is not on, above its desktop or setup: a refused start in the owner's language, with the smaller
 * memory that would start it now when there is one.
 */
export function ComputerError(props: {
  error: string;
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
