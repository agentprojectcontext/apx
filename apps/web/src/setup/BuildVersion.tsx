import { useT } from "../i18n/index.ts";

/** The build at the foot of the first-run screens: its version, and "Beta" while v2 is one. */
export function BuildVersion({ className = "" }: { className?: string }) {
  const t = useT();
  const beta = import.meta.env.VITE_APX_CHANNEL === "beta";
  return (
    <footer className={`wiz__version${className}`}>
      APX v{import.meta.env.VITE_APX_VERSION}
      {beta && ` · ${t("setup.beta")}`}
    </footer>
  );
}
