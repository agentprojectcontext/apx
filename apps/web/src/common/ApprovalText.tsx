import { Button } from "@apx/ui";
import { type ReactNode, useEffect, useState } from "react";
import { addPack, isKey, useLanguage, useT } from "../i18n/index.ts";

/** Decision controls and their warnings appear together, including after a failed download. */
export function ApprovalText({
  children,
  preserve = false,
  context,
}: {
  children: ReactNode;
  preserve?: boolean;
  context?: "browser";
}) {
  const t = useT();
  const language = useLanguage();
  const ready = isKey("input.approved");
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    if (ready) setLoaded(true);
    if (!ready)
      void addPack("approvals", language).catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [ready, language]);
  return (
    <>
      <div hidden={!ready} style={ready ? { display: "contents" } : undefined}>
        {(ready || (preserve && loaded)) && children}
      </div>
      {!ready && (
        <section role={failed ? "alert" : "status"} aria-busy={!failed}>
          <p>
            {t(
              context === "browser"
                ? failed
                  ? "common.browserPermissionsFailed"
                  : "common.browserPermissionsLoading"
                : failed
                  ? "common.optionsFailed"
                  : "common.optionsLoading",
            )}
          </p>
          {failed && (
            <Button variant="secondary" onClick={() => window.location.reload()}>
              {t("common.retry")}
            </Button>
          )}
        </section>
      )}
    </>
  );
}
