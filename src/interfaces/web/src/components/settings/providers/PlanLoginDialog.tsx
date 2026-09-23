import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, LogIn, LogOut } from "lucide-react";
import { Button, Dialog, Field, Input } from "../../ui";
import { Engines } from "../../../lib/api";
import { t } from "../../../i18n";
import type { Provider } from "./types";
import codexLogo from "../../../assets/cli/codex.webp";
import claudeLogo from "../../../assets/cli/claude.webp";

/** ChatGPT account toggle required before device-code Continue works. */
export const CHATGPT_CODEX_DEVICE_AUTH_SETTINGS =
  "https://chatgpt.com/#settings/Security";

function authTarget(p: Provider): "chatgpt-codex" | "claude-subscription" {
  if (p.slug === "claude-subscription" || p.engine === "claude-subscription") {
    return "claude-subscription";
  }
  return "chatgpt-codex";
}

function isClaude(p: Provider) {
  return authTarget(p) === "claude-subscription";
}

export function PlanLoginDialog({
  open,
  provider,
  onClose,
  onDone,
}: {
  open: boolean;
  provider: Provider | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<"idle" | "starting" | "waiting" | "code" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [accountHint, setAccountHint] = useState<string | null>(null);
  const [userCode, setUserCode] = useState("");
  const [verifyUrl, setVerifyUrl] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [pasteCode, setPasteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [codexReady, setCodexReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const reset = () => {
    stopPoll();
    setPhase("idle");
    setError(null);
    setUserCode("");
    setVerifyUrl("");
    setSessionId("");
    setAuthUrl("");
    setPasteCode("");
    setBusy(false);
    setCodexReady(false);
    setCopied(false);
  };

  useEffect(() => {
    cancelled.current = false;
    if (!open || !provider) {
      reset();
      return;
    }
    const target = authTarget(provider);
    setPhase("idle");
    setError(null);
    setCodexReady(false);
    setCopied(false);
    Engines.authStatus(target)
      .then((s) => {
        if (cancelled.current) return;
        setLoggedIn(!!s.logged_in);
        setAccountHint(s.account_id ? String(s.account_id).slice(0, 12) : null);
      })
      .catch(() => {
        if (!cancelled.current) setLoggedIn(false);
      });
    return () => {
      cancelled.current = true;
      stopPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider?.slug]);

  if (!provider) return null;
  const claude = isClaude(provider);
  const logo = claude ? claudeLogo : codexLogo;
  const title = claude ? "Claude (Max)" : "ChatGPT/Codex";
  const target = authTarget(provider);
  const canStart = claude || codexReady;
  const showPreflight =
    !claude
    && !codexReady
    && (phase === "idle" || phase === "done" || phase === "error");

  const copyCode = async () => {
    if (!userCode) return;
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  const startLogin = async () => {
    if (!claude && !codexReady) return;
    setBusy(true);
    setError(null);
    setPhase("starting");
    setCopied(false);
    try {
      const started = await Engines.authLoginStart(target);
      if (started.flow === "device_code") {
        setUserCode(started.user_code || "");
        setVerifyUrl(started.verification_url || "");
        setPhase("waiting");
        if (started.verification_url) {
          window.open(started.verification_url, "_blank", "noopener,noreferrer");
        }
        stopPoll();
        const deviceAuthId = started.device_auth_id || "";
        const code = started.user_code || "";
        pollRef.current = setInterval(async () => {
          try {
            const r = await Engines.authLoginPoll(target, {
              device_auth_id: deviceAuthId,
              user_code: code,
            });
            if (r.done) {
              stopPoll();
              setLoggedIn(true);
              setAccountHint(r.account_id ? String(r.account_id).slice(0, 12) : null);
              setPhase("done");
              onDone();
            }
          } catch (e) {
            stopPoll();
            setPhase("error");
            setError((e as Error).message || t("plan_login.err"));
          }
        }, Math.max(3, started.interval_s || 5) * 1000);
      } else {
        setSessionId(started.session_id || "");
        setAuthUrl(started.auth_url || "");
        setPhase("code");
        if (started.auth_url) {
          window.open(started.auth_url, "_blank", "noopener,noreferrer");
        }
      }
    } catch (e) {
      setPhase("error");
      setError((e as Error).message || t("plan_login.err"));
    } finally {
      setBusy(false);
    }
  };

  const submitClaudeCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await Engines.authLoginComplete(target, { session_id: sessionId, code: pasteCode.trim() });
      setLoggedIn(true);
      setPhase("done");
      onDone();
    } catch (e) {
      setPhase("error");
      setError((e as Error).message || t("plan_login.err"));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    setError(null);
    try {
      await Engines.authLogout(target);
      setLoggedIn(false);
      setAccountHint(null);
      reset();
      onDone();
    } catch (e) {
      setError((e as Error).message || t("plan_login.err"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => { stopPoll(); onClose(); }}
      title={t("plan_login.title", { name: title })}
      description={claude ? t("plan_login.claude_desc") : t("plan_login.codex_desc")}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => { stopPoll(); onClose(); }} disabled={busy}>
            {t("common.close")}
          </Button>
          {loggedIn && phase !== "waiting" && phase !== "code" ? (
            <Button variant="secondary" onClick={logout} loading={busy}>
              <LogOut className="size-3.5" /> {t("plan_login.logout")}
            </Button>
          ) : null}
          {phase === "idle" || phase === "done" || phase === "error" ? (
            <Button
              variant="primary"
              onClick={startLogin}
              loading={busy || phase === "starting"}
              disabled={!canStart}
            >
              <LogIn className="size-3.5" /> {loggedIn ? t("plan_login.relogin") : t("plan_login.login")}
            </Button>
          ) : null}
          {phase === "code" ? (
            <Button variant="primary" onClick={submitClaudeCode} loading={busy} disabled={!pasteCode.trim()}>
              {t("plan_login.submit_code")}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-3">
          <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-border">
            <img src={logo} alt="" className="size-10 object-contain" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted-fg">
              {loggedIn
                ? t("plan_login.status_in", { hint: accountHint || "…" })
                : t("plan_login.status_out")}
            </p>
          </div>
        </div>

        {showPreflight && (
          <div className="space-y-2 rounded-lg border border-amber-600/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-100">
            <p className="font-medium">{t("plan_login.codex_preflight_title")}</p>
            <p className="text-[11px] leading-relaxed opacity-90">{t("plan_login.codex_preflight_body")}</p>
            <a
              href={CHATGPT_CODEX_DEVICE_AUTH_SETTINGS}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium underline"
            >
              {t("plan_login.codex_preflight_link")} <ExternalLink className="size-3" />
            </a>
            <label className="mt-1 flex cursor-pointer items-start gap-2 text-[11px]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={codexReady}
                onChange={(e) => setCodexReady(e.target.checked)}
              />
              <span>{t("plan_login.codex_preflight_check")}</span>
            </label>
          </div>
        )}

        {!claude && codexReady && (phase === "idle" || phase === "done" || phase === "error") && (
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-fg">
            <input
              type="checkbox"
              checked={codexReady}
              onChange={(e) => setCodexReady(e.target.checked)}
            />
            <span>{t("plan_login.codex_preflight_check")}</span>
          </label>
        )}

        {phase === "waiting" && (
          <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs text-muted-fg">{t("plan_login.codex_steps")}</p>
            <a
              href={verifyUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 break-all text-xs text-foreground underline"
            >
              {verifyUrl} <ExternalLink className="size-3 shrink-0" />
            </a>
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-fg">
                {t("plan_login.enter_code")}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg border border-border bg-background px-3 py-3 text-center font-mono text-2xl font-semibold tracking-[0.2em] text-foreground sm:text-3xl">
                  {userCode}
                </code>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={copyCode}
                  aria-label={t("common.copy")}
                  className="shrink-0 self-stretch px-3"
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? t("plan_login.copied") : t("common.copy")}
                </Button>
              </div>
            </div>
            <p className="flex items-center gap-2 text-xs text-muted-fg">
              <Loader2 className="size-3.5 animate-spin" />
              {t("plan_login.waiting")}
            </p>
          </div>
        )}

        {phase === "code" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-fg">{t("plan_login.claude_steps")}</p>
            <a
              href={authUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 break-all text-xs text-foreground underline"
            >
              {t("plan_login.open_auth")} <ExternalLink className="size-3 shrink-0" />
            </a>
            <Field label={t("plan_login.code_label")} hint={t("plan_login.code_hint")}>
              <Input
                value={pasteCode}
                onChange={(e) => setPasteCode(e.target.value)}
                placeholder="code#state"
                autoFocus
              />
            </Field>
          </div>
        )}

        {phase === "done" && (
          <p className="rounded-md border border-emerald-600/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            {t("plan_login.success")}
          </p>
        )}

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
