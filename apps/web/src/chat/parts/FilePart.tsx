import type { Part } from "@apx/protocol";
import { Icons } from "@apx/ui";
import { useState } from "react";
import { formatNumber } from "../../common/format.ts";
import { mediaUrl } from "../../data/media.ts";

const size = (b: number) =>
  b >= 1024 * 1024 ? `${formatNumber(b / 1024 / 1024, { maximumFractionDigits: 1 })} MB` : `${Math.ceil(b / 1024)} KB`;

/** A file the owner attached: its name and size; opens (downloads) through media.get on click. */
export function FilePart({ part }: { part: Extract<Part, { type: "file" }> }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      const url = await mediaUrl(part.media_id);
      const a = document.createElement("a");
      a.href = url;
      a.download = part.name;
      a.click();
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="filepart" onClick={() => void open()} disabled={busy} title={part.name}>
      <Icons.FileText size={14} />
      <span className="filepart__name">{part.name}</span>
      <span className="filepart__size">{size(part.bytes)}</span>
    </button>
  );
}
