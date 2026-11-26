import { Skeleton } from "@apx/ui";
import { useT } from "../i18n/index.ts";

/** Rows sketched while a list loads, never an empty list: `avatar` is the size of the faces of the rows it stands for. */
export function InboxSkeleton({ rows = 5, avatar = 36, label }: { rows?: number; avatar?: number; label?: string }) {
  return (
    <div className="inbox__skeleton" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders with nothing else to tell them apart
        <div key={i} className="inbox__skelrow">
          <Skeleton shape="circle" width={avatar} />
          <div className="inbox__skeltext">
            <Skeleton width={`${60 - (i % 3) * 10}%`} />
            <Skeleton width={`${85 - (i % 2) * 20}%`} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The Tasks tab while its tasks load: rows shaped like a task's. */
export function TasksSkeleton() {
  const t = useT();
  return <InboxSkeleton rows={6} avatar={24} label={t("inbox.taskSections.loading")} />;
}
