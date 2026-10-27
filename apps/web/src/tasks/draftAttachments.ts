import { useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import type { Attached } from "../data/composer.ts";
import { notify } from "../data/notices.ts";

export async function discardTaskUpload(id: string): Promise<void> {
  await client.call("media.discard", { id });
}

export function cleanupTaskUpload(id: string): void {
  void discardTaskUpload(id).catch((error: unknown) => {
    notify(error instanceof Error ? error.message : String(error));
  });
}

export function useDraftAttachments() {
  const [attachments, setAttachments] = useState<Attached[]>([]);
  const pending = useRef<Attached[]>([]);
  useEffect(
    () => () => {
      for (const asset of pending.current) cleanupTaskUpload(asset.id);
      pending.current = [];
    },
    [],
  );
  const change = (value: Attached[]) => {
    pending.current = value;
    setAttachments(value);
  };
  // The core consumes pending sources atomically on a successful create.
  const consumed = () => {
    pending.current = [];
  };
  return { attachments, change, consumed };
}
