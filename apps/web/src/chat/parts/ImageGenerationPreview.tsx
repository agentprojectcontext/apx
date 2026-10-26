import type { CSSProperties } from "react";
import { useT } from "../../i18n/index.ts";
import "./ImageGenerationPreview.css";

const DELAYS = [
  0.85, 0.55, 0.4, 0.55, 0.85, 0.55, 0.3, 0.16, 0.3, 0.55, 0.4, 0.16, 0, 0.08, 0.4, 0.55, 0.3, 0.08, 0.16, 0.55, 0.85,
  0.55, 0.4, 0.55, 0.85,
];

export function ImageGenerationPreview() {
  const t = useT();
  return (
    <div className="image-generation-preview" role="status" aria-label={t("media.generating")}>
      <div className="image-generation-preview__tiles" aria-hidden="true">
        {DELAYS.map((delay, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positional tiles
          <i key={index} style={{ "--tile-delay": `${delay}s` } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}
