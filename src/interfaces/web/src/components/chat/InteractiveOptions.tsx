import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "../ui";
import { WhatsApp } from "../../lib/api/whatsapp";
import type { InteractiveMenu } from "../../types/daemon";
import { t } from "../../i18n";

/**
 * The menu a message offered, drawn as the buttons it actually had.
 *
 * A company does not write sentences: it sends three quick-reply buttons or a
 * "ver opciones" list. The ledger stores that as text with the choices numbered
 * inline — "[Opciones: 1. Autos | 2. Hogar]" — because that is how a MODEL
 * answers a menu, by writing "2". A person reading the same thread taps, and
 * until now had nothing to tap: the panel showed a bracketed line about buttons
 * that were not there.
 *
 * Tapping sends the choice through the same core path as the agent's own
 * (POST /whatsapp/choose → chooseWhatsAppOption), so a real button press leaves
 * where the protocol supports one and the label is typed where it does not. The
 * panel never builds a proto and never guesses which option was meant — it
 * sends the number that is on the screen.
 */
export function InteractiveOptions({ menu }: { menu: InteractiveMenu }) {
  // Which one was tapped, and whether it has left. One at a time on purpose: a
  // menu takes ONE answer, and a second tap while the first is in flight would
  // send two.
  const [sending, setSending] = useState<number | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState("");

  const jid = menu.chat || "";
  const options = menu.options || [];
  if (!options.length) return null;

  const choose = async (n: number) => {
    if (!jid || sending !== null || sent !== null) return;
    setSending(n);
    setError("");
    try {
      await WhatsApp.choose(jid, n);
      setSent(n);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-1">
      {options.map((o) => {
        const isSent = sent === o.n;
        return (
          <Button
            key={o.n}
            variant={isSent ? "primary" : "secondary"}
            // Full width and stacked: this is what the menu looks like on a
            // phone, and a row of chips reads as filters rather than choices.
            className="h-auto w-full justify-start whitespace-normal px-3 py-1.5 text-left text-sm"
            disabled={!jid || sending !== null || sent !== null}
            onClick={() => choose(o.n)}
            title={o.description || o.title}
          >
            {sending === o.n ? (
              <Loader2 size={13} className="mr-1.5 shrink-0 animate-spin" />
            ) : isSent ? (
              <Check size={13} className="mr-1.5 shrink-0" />
            ) : (
              <span className="mr-1.5 shrink-0 text-muted-foreground">{o.n}.</span>
            )}
            {o.title}
          </Button>
        );
      })}
      {/* No jid means the row predates the menu being recorded with its chat —
          the buttons still SHOW what was offered, which is the point, but there
          is nowhere to send a tap. Saying so beats a dead button. */}
      {!jid && <p className="text-xs text-muted-foreground">{t("chat_ui.menu_no_chat")}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
