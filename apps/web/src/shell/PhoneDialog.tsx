import { Button, Dialog, Icons } from "@apx/ui";
import { go, useNav } from "./nav.ts";

/** Placeholder until device pairing lands (F6): no QR is shown because nothing can be paired yet. */
export function PhoneDialog() {
  const open = useNav((s) => s.phone);
  return (
    <Dialog
      open={open}
      onOpenChange={go.phone}
      size="md"
      title="Abrir en el teléfono"
      description="Escaneá un QR con la cámara para abrir este chat en el teléfono."
      footer={
        <Button variant="secondary" onClick={() => go.phone(false)}>
          Cerrar
        </Button>
      }
    >
      <div className="phone">
        <div className="phone__qr" aria-hidden="true">
          <Icons.Smartphone size={28} />
          <span>Pronto</span>
        </div>
        <p className="phone__hint">
          La vinculación de dispositivos llega con la app móvil: un escaneo abre el chat y vincula el teléfono.
        </p>
      </div>
    </Dialog>
  );
}
