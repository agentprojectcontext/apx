import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button, Input, Field } from "../components/ui";
import { Pair, setToken, HttpError } from "../lib/api";
import { STORAGE } from "../constants";
import { t } from "../i18n";

// Shown when the panel is reachable but has no valid token — i.e. opened over
// the LAN or a tunnel where /admin/web-token (loopback-only) can't help. The
// browser plays the same role APX Deck does: the operator runs `apx pair` on
// the host and pastes the pairing code here to mint a per-client token.
export function PairingScreen({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState(defaultLabel());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    const pairing_id = code.trim();
    if (!pairing_id) { setErr(t("pairing.err_required")); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await Pair.confirm({ pairing_id, label: label.trim() || undefined });
      setToken(res.token);
      try { localStorage.setItem(STORAGE.token, res.token); } catch { /* quota */ }
      onPaired();
    } catch (e) {
      setErr(messageFor(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center overflow-y-auto bg-background p-4 text-foreground">
      <div className="my-auto w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <KeyRound size={20} />
          </div>
          <div>
            <h1 className="text-base font-semibold">{t("pairing.title")}</h1>
            <p className="text-xs text-muted-fg">{t("pairing.subtitle")}</p>
          </div>
        </div>

        <ol className="mb-5 space-y-1.5 rounded-lg bg-muted/50 p-3 text-xs text-muted-fg">
          <li className="font-medium text-foreground">{t("pairing.steps_title")}</li>
          <li>1. {t("pairing.step_1")}</li>
          <li>2. {t("pairing.step_2")}</li>
          <li>3. {t("pairing.step_3")}</li>
        </ol>

        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          <Field label={t("pairing.code_label")}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("pairing.code_ph")}
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
          <Field label={t("pairing.label_label")} hint={t("pairing.revoke_hint")}>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("pairing.label_ph")}
            />
          </Field>

          {err && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>
          )}

          <Button type="submit" variant="primary" size="md" loading={busy} className="w-full justify-center">
            {busy ? t("pairing.linking") : t("pairing.submit")}
          </Button>
        </form>
      </div>
    </div>
  );
}

function defaultLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux";
  return "browser";
}

function messageFor(e: unknown): string {
  if (e instanceof HttpError) {
    if (e.status === 410) return t("pairing.err_expired");
    if (e.status === 404) return t("pairing.err_unknown");
    if (e.status === 409) return t("pairing.err_unknown");
  }
  return t("pairing.err_generic");
}
