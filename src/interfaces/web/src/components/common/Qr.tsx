import { useEffect, useState } from "react";
import QRCode from "qrcode";

// Renders `value` as a QR PNG. White-on-dark-agnostic: we draw black modules
// on a white quiet zone so any phone camera reads it regardless of app theme.
export function Qr({ value, size = 200 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 2, width: size * 2, errorCorrectionLevel: "M" })
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [value, size]);

  return (
    <div
      className="grid place-items-center rounded-lg bg-white p-3"
      style={{ width: size + 24, height: size + 24 }}
    >
      {src
        ? <img src={src} width={size} height={size} alt="QR" />
        : <div className="size-full animate-pulse rounded bg-muted" />}
    </div>
  );
}
