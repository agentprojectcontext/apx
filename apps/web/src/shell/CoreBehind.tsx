import { Button, Dialog, Icons } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";

/**
 * The core answering this panel runs an older release than the app: usually the one install.sh put in ~/.apx/v2/app,
 * which a service keeps running and the desktop app's own update never touches. Methods the panel uses may be missing.
 */
export function CoreBehind({ version }: { version: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const app = import.meta.env.VITE_APX_VERSION;
  return (
    <>
      <button type="button" className="updatepill" aria-label={t("update.coreBehind")} onClick={() => setOpen(true)}>
        <Icons.TriangleAlert size={12} />
        <span className="updatepill__label">{t("update.coreBehind")}</span>
      </button>
      {open && (
        <Dialog
          open
          onOpenChange={setOpen}
          title={t("update.coreBehindTitle")}
          footer={<Button onClick={() => setOpen(false)}>{t("common.close")}</Button>}
        >
          <p>{t("update.coreBehindBody", { core: version, app })}</p>
          <p>{t("update.coreBehindUpdate")}</p>
          <pre className="updatepill__cmd">curl -fsSL https://apxagent.app/install.sh | bash</pre>
          <p>{t("update.coreBehindAppOnly")}</p>
          <pre className="updatepill__cmd">apx service uninstall</pre>
        </Dialog>
      )}
    </>
  );
}
