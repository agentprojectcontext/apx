// The QR library loads only when a code shows (pairing a phone, linking WhatsApp), never with the first screen.
import { lazy, Suspense } from "react";

const QrSvg = lazy(() => import("./QrSvg.tsx").then((m) => ({ default: m.QrSvg })));

export type QrCodeProps = { value: string; size?: number; label: string };

export function QrCode(props: QrCodeProps) {
  const size = props.size ?? 260;
  return (
    <Suspense fallback={<span className="qrcode" style={{ display: "inline-block", width: size, height: size }} />}>
      <QrSvg {...props} />
    </Suspense>
  );
}
