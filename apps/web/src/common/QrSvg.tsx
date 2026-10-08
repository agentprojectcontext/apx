import qrcode from "qrcode-generator";
import { useMemo } from "react";
import type { QrCodeProps } from "./QrCode.tsx";

/**
 * A QR code drawn as SVG squares (dark on light, with its quiet zone), from the text it carries. Every module gets the
 * same whole number of pixels: uneven modules are what a phone camera struggles with.
 */
export function QrSvg({ value, size = 260, label }: QrCodeProps) {
  const { n, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < count; r++)
      for (let c = 0; c < count; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { n: count + 8, path: d };
  }, [value]);
  const px = Math.max(3, Math.floor(size / n)) * n;
  return (
    <svg
      className="qrcode"
      role="img"
      aria-label={label}
      width={px}
      height={px}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
    >
      <rect width={n} height={n} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
