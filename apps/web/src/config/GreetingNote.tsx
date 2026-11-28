import { useEffect } from "react";
import { loadVoice } from "../data/voice.ts";
import { useT } from "../i18n/index.ts";

/** The greeting is being made again in the new voice: says so, and asks again every couple of seconds until it is. */
export function GreetingNote({ className }: { className: string }) {
  const t = useT();
  useEffect(() => {
    const iv = setInterval(() => void loadVoice(), 2000);
    return () => clearInterval(iv);
  }, []);
  return (
    <p className={className} role="status">
      {t("voice.greetingPreparing")}
    </p>
  );
}
