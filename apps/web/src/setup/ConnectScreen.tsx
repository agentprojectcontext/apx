import "../styles/wizard.css";
import { Button, Icons, Input, SegmentedControl } from "@apx/ui";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import logo from "../assets/logo.png";
import { type MessageKey, useT } from "../i18n/index.ts";
import { CrewHero } from "./CrewHero.tsx";
import { StepHead } from "./StepsIntro.tsx";

type Access = "none" | "lan" | "tailscale";
type Via = "url" | "ssh";
type Answer = { ok: true } | { ok: false; reason?: string; error?: string };

/** How long the intro holds the hero alone before the question unrolls under it. */
const INTRO_MS = 3400;
/** What puts the APX daemon on a server that has none (install.sh, attached to every release). */
const INSTALL =
  "curl -fsSL https://github.com/agentprojectcontext/apx/releases/latest/download/install.sh | bash\napx setup --headless";

const ACCESS: Array<{ id: Access; icon: typeof Icons.Lock; title: MessageKey; body: MessageKey }> = [
  { id: "none", icon: Icons.Lock, title: "connect.access.none", body: "connect.access.noneBody" },
  { id: "lan", icon: Icons.House, title: "connect.access.lan", body: "connect.access.lanBody" },
  { id: "tailscale", icon: Icons.Globe, title: "connect.access.tailscale", body: "connect.access.tailscaleBody" },
];
/** What the desktop app answers when a client connection fails, as the owner reads it. */
const REASONS: Record<string, MessageKey> = {
  badUrl: "connect.error.badUrl",
  notReachable: "connect.error.notReachable",
  badSsh: "connect.error.badSsh",
  sshFailed: "connect.error.sshFailed",
  sshDown: "connect.error.sshDown",
  sshNoApx: "connect.error.sshNoApx",
};

/**
 * The desktop app's first run, before any APX is reached: this computer runs APX (server), or the app connects to one
 * elsewhere (client). Shown only inside the desktop app, which answers through window.apxConnect.
 */
export function ConnectScreen() {
  const t = useT();
  const [step, setStep] = useState<"start" | "server" | "client">("start");
  const [access, setAccess] = useState<Access>("none");
  const [via, setVia] = useState<Via>("url");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [install, setInstall] = useState(false);
  // The website's hero first; then, like a blind, it rises and the question unrolls under it (at once with less motion).
  const [revealed, setRevealed] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    if (revealed) return;
    const reveal = () => setRevealed(true);
    const timer = window.setTimeout(reveal, INTRO_MS);
    window.addEventListener("keydown", reveal);
    window.addEventListener("pointerdown", reveal);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", reveal);
      window.removeEventListener("pointerdown", reveal);
    };
  }, [revealed]);

  const answer = async (ask: () => Promise<Answer> | undefined) => {
    setBusy(true);
    setError(undefined);
    setInstall(false);
    const r = await ask();
    // Connected: the window leaves this page; until then the button stays busy.
    if (!r || r.ok) return;
    setBusy(false);
    setError(r.reason && REASONS[r.reason] ? t(REASONS[r.reason] as MessageKey) : (r.error ?? r.reason));
    setInstall(r.reason === "sshNoApx");
  };
  const startServer = () => void answer(() => window.apxConnect?.local(access));
  const connect = (e: FormEvent) => {
    e.preventDefault();
    if (!address.trim() || busy) return;
    void answer(() => (via === "url" ? window.apxConnect?.url(address) : window.apxConnect?.ssh(address)));
  };
  const back = () => {
    setStep("start");
    setError(undefined);
    setInstall(false);
  };

  return (
    <div className="wiz is-connect" data-apx-look="minimal" data-apx-mode="dark">
      <header className="wiz__head">
        <div className="wiz__brand">
          <img src={logo} alt="" width={24} height={24} />
          <span>APX</span>
        </div>
      </header>
      <div className="wiz__scroll">
        <div className="wiz__grid is-single connect">
          {step === "start" && (
            <div className={`connect__stage${revealed ? " is-ready" : ""}`}>
              <CrewHero compact={revealed} />
              <div className="connect__blind" inert={!revealed}>
                <div className="wiz__main">
                  <StepHead kicker="connect.kicker" title={t("connect.title")} end={t("connect.titleEnd")} green>
                    {t("connect.body")}
                  </StepHead>
                  <div className="wiz__choices">
                    <Choice id="pick-server" icon={<Icons.Monitor size={16} />} onClick={() => setStep("server")}>
                      {t("connect.server")}
                      {t("connect.serverBody")}
                    </Choice>
                    <Choice id="pick-client" icon={<Icons.Server size={16} />} onClick={() => setStep("client")}>
                      {t("connect.client")}
                      {t("connect.clientBody")}
                    </Choice>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === "server" && (
            <div className="wiz__main">
              <StepHead
                kicker="connect.kickerServer"
                title={t("connect.accessTitle")}
                end={t("connect.accessTitleEnd")}
              >
                {t("connect.accessBody")}
              </StepHead>
              <div className="wiz__options">
                {ACCESS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    data-access={a.id}
                    aria-pressed={access === a.id}
                    className={`wiz__option${access === a.id ? " is-on" : ""}`}
                    onClick={() => setAccess(a.id)}
                  >
                    <span className="wiz__choicetitle">
                      <a.icon size={16} />
                      {t(a.title)}
                    </span>
                    <span className="wiz__choicebody">{t(a.body)}</span>
                  </button>
                ))}
              </div>
              <p className="wiz__hintline">{t("connect.importNext")}</p>
              {error && (
                <span className="wiz__hintline is-error" role="alert">
                  {error}
                </span>
              )}
              <div className="wiz__foot">
                <button type="button" className="wiz__back" onClick={back}>
                  {t("setup.back")}
                </button>
                <span className="wiz__spacer" />
                <Button id="server-go" size="lg" loading={busy} onClick={startServer}>
                  {t("connect.start")}
                </Button>
              </div>
            </div>
          )}

          {step === "client" && (
            <form className="wiz__main" onSubmit={connect}>
              <StepHead
                kicker="connect.kickerClient"
                title={t("connect.clientTitle")}
                end={t("connect.clientTitleEnd")}
                green
              >
                {t("connect.clientLead")}
              </StepHead>
              <div className="connect__via">
                <SegmentedControl
                  options={[
                    { value: "url", label: t("connect.byUrl") },
                    { value: "ssh", label: "SSH" },
                  ]}
                  value={via}
                  onValueChange={(v) => {
                    setVia(v as Via);
                    setError(undefined);
                    setInstall(false);
                  }}
                />
              </div>
              <div className="wiz__field">
                <span>{t(via === "url" ? "connect.urlLabel" : "connect.sshLabel")}</span>
                <Input
                  id={via === "url" ? "url" : "ssh"}
                  className="wiz__name"
                  size="lg"
                  aria-label={t(via === "url" ? "connect.urlLabel" : "connect.sshLabel")}
                  placeholder={via === "url" ? "https://my-server.ts.net" : "user@server"}
                  value={address}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoFocus
                  invalid={Boolean(error)}
                  leadingIcon={via === "url" ? <Icons.Link size={16} /> : <Icons.Terminal size={16} />}
                  onChange={(e) => setAddress(e.currentTarget.value)}
                />
                <span className="wiz__hintline">{t(via === "url" ? "connect.urlHint" : "connect.sshHint")}</span>
                {error && (
                  <span id="client-error" className="wiz__hintline is-error" role="alert">
                    {error}
                  </span>
                )}
                {install && <pre className="connect__install">{INSTALL}</pre>}
              </div>
              <div className="wiz__foot">
                <button type="button" className="wiz__back" onClick={back}>
                  {t("setup.back")}
                </button>
                <span className="wiz__spacer" />
                <Button id="client-go" type="submit" size="lg" loading={busy} disabled={!address.trim()}>
                  {t("connect.connect")}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/** One of the two first choices, drawn like the setup's "start fresh / import" cards: a title line, then a body. */
function Choice(props: { id: string; icon: ReactNode; onClick: () => void; children: [string, string] }) {
  const [title, body] = props.children;
  return (
    <button id={props.id} type="button" className="wiz__choice" onClick={props.onClick}>
      <span className="wiz__choicetitle">
        {props.icon}
        {title}
      </span>
      <span className="wiz__choicebody">{body}</span>
    </button>
  );
}
