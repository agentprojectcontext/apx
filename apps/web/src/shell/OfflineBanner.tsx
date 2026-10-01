import { Button, Icons } from "@apx/ui";
import { retryNow } from "../data/live.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";

/** Thin strip under the topbar while the core is unreachable. */
export function OfflineBanner() {
  const t = useT();
  const connection = useData((s) => s.connection);
  const error = useData((s) => s.error);
  const ready = useData((s) => s.ready);
  if (connection !== "offline") return null;
  return (
    <div className="offline" role="alert">
      <Icons.WifiOff size={14} />
      <span className="offline__text">
        {ready ? t("offline.stale") : t("offline.cannotConnect")}
        {error && <span className="offline__detail"> {error}</span>}
      </span>
      <Button size="sm" variant="secondary" leadingIcon={<Icons.RefreshCw size={12} />} onClick={retryNow}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
