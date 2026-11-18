import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { readDocument, watchPublication } from "./cloud.ts";
import { createPublicationController } from "./controller.ts";
import { createCopyReader } from "./read.ts";

export function usePublication(code: string) {
  const controller = useMemo(
    () =>
      createPublicationController({
        valid: /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/.test(code),
        load: createCopyReader(code, readDocument),
        watch: (changed, failed) => watchPublication(code, changed, failed),
        after: (ms, callback) => {
          const timer = window.setTimeout(callback, ms);
          return () => window.clearTimeout(timer);
        },
        online: () => navigator.onLine,
      }),
    [code],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const activeDownload = useRef<string | undefined>(undefined);
  useEffect(() => {
    controller.start();
    window.addEventListener("offline", controller.offline);
    return () => {
      controller.stop();
      window.removeEventListener("offline", controller.offline);
      if (activeDownload.current) URL.revokeObjectURL(activeDownload.current);
      activeDownload.current = undefined;
    };
  }, [controller]);
  useEffect(() => {
    if (!state.copy && activeDownload.current) {
      URL.revokeObjectURL(activeDownload.current);
      activeDownload.current = undefined;
    }
  }, [state.copy]);
  async function download() {
    const result = await controller.download();
    if (!result?.current()) return;
    if (activeDownload.current) URL.revokeObjectURL(activeDownload.current);
    const url = URL.createObjectURL(new Blob([result.copy.json], { type: "application/vnd.apx.artifact+json" }));
    activeDownload.current = url;
    const link = document.createElement("a");
    link.href = url;
    link.download = `${result.copy.bundle.manifest.name}.apxart`;
    link.click();
  }
  return { ...state, download, validCode: /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/.test(code), retry: controller.start };
}
