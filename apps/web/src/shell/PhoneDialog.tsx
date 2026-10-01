import { Button, Dialog, Icons } from "@apx/ui";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "./nav.ts";

/** Placeholder until device pairing lands (F6): no QR is shown because nothing can be paired yet. */
export function PhoneDialog() {
  const t = useT();
  const open = useNav((s) => s.phone);
  return (
    <Dialog
      open={open}
      onOpenChange={go.phone}
      size="md"
      title={t("phone.open")}
      description={t("phone.description")}
      closeLabel={t("common.close")}
      footer={
        <Button variant="secondary" onClick={() => go.phone(false)}>
          {t("common.close")}
        </Button>
      }
    >
      <div className="phone">
        <div className="phone__qr" aria-hidden="true">
          <Icons.Smartphone size={28} />
          <span>{t("common.soon")}</span>
        </div>
        <p className="phone__hint">{t("phone.hint")}</p>
      </div>
    </Dialog>
  );
}
