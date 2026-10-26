import { Skeleton } from "@apx/ui";
import "../styles/usage.css";

/** A full-sized preview also used while the panel's code and translations arrive. */
export function UsageLoading({ labels = [], slots = 3 }: { labels?: string[]; slots?: number }) {
  return (
    <div className="usage usage--compact usage-loading" aria-busy="true" data-testid="usage-loading">
      {(labels.length ? labels : Array.from({ length: slots }, () => "")).map((label, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: preview slots have no state
        <section className="usage__block engine-usage__engine" key={i}>
          {label ? <h3 className="usage__head">{label}</h3> : <Skeleton width="45%" height={18} />}
          <Skeleton width="75%" height={14} />
          <Skeleton height={8} />
          <Skeleton width="60%" height={14} />
        </section>
      ))}
    </div>
  );
}
