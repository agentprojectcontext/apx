import { useEffect, useState } from "react";
import { MessageSquare, Smartphone, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { installStance, onInstallStateChange, promptInstall } from "../lib/pwa";
import { cn } from "../lib/cn";
import { t } from "../i18n";

/**
 * "You are on a phone, and this is the desktop panel."
 *
 * The manifest's start_url points at /mobile, but that only applies once the
 * app is INSTALLED. Opening the URL in a browser lands on `/` — the desktop
 * shell, on a 400px screen — which is exactly where the phone surface is least
 * discoverable and where the install banner (which lives inside /mobile) never
 * appears. So the two offers go here, on the screen you actually land on.
 *
 * Deliberately not a redirect: someone may want the full panel on a tablet, or
 * on a phone, and being moved somewhere else without asking is worse than a
 * card you can dismiss.
 */
const DISMISSED = "apx.mobilehint.dismissed";
const NARROW = 820;

export function MobileHint() {
  const navigate = useNavigate();
  const [, bump] = useState(0);
  const [narrow, setNarrow] = useState(() => window.innerWidth <= NARROW);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth <= NARROW);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Chrome fires beforeinstallprompt whenever it likes, usually after paint.
  useEffect(() => onInstallStateChange(() => bump((n) => n + 1)), []);

  if (hidden || !narrow) return null;

  const stance = installStance();
  const canInstall = stance.kind === "prompt";

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      /* private mode: gone for this session, which is enough */
    }
  };

  return (
    <div
      className={cn(
        "fixed inset-x-3 z-50 flex items-center gap-2 rounded-2xl border border-border bg-card/95 p-2 shadow-lg backdrop-blur",
        // Above the home indicator, and above anything the page floats there.
        "bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
      )}
    >
      <button
        type="button"
        onClick={() => navigate("/m/chat")}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
      >
        <MessageSquare size={15} className="shrink-0" />
        <span className="truncate">{t("mobile_link.open_chat")}</span>
      </button>
      {canInstall && (
        <button
          type="button"
          onClick={() => void promptInstall()}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm"
        >
          <Smartphone size={15} />
          <span className="hidden xs:inline">{t("access.install_now")}</span>
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("common.close")}
        className="shrink-0 rounded-lg p-2 text-muted-fg hover:text-foreground"
      >
        <X size={15} />
      </button>
    </div>
  );
}
