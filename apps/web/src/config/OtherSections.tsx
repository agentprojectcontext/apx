import { Badge, Button, EmptyState, Icons, Input, ProjectTile, SegmentedControl, SettingRow, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { loadHealth } from "../data/engines.ts";
import { DEFAULT_NAME, initialsOf, setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { go, useNav } from "../shell/nav.ts";
import { SectionHead } from "./SectionHead.tsx";

/** Cuenta: how the panel calls you. Stored in this browser only. */
export function AccountSection() {
  const name = usePrefs((s) => s.displayName);
  const [draft, setDraft] = useState(name);
  const save = () => setPrefs({ displayName: draft.trim() || DEFAULT_NAME });
  return (
    <>
      <SectionHead
        title="Cuenta"
        lead="Tu perfil en este panel. Se guarda en este navegador y no sale de tu máquina."
      />
      <div className="account-card">
        <span className="account-card__avatar">{initialsOf(draft || DEFAULT_NAME)}</span>
        <div className="account-card__text">
          <div className="account-card__name">{name}</div>
          <div className="account-card__sub">Dueño de esta instalación</div>
        </div>
      </div>
      <SettingRow title="Nombre" description="Cómo te muestra el panel. Los agentes todavía no lo leen.">
        <Input
          size="sm"
          className="config__input"
          value={draft}
          placeholder={DEFAULT_NAME}
          maxLength={40}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && save()}
          aria-label="Nombre"
        />
      </SettingRow>
      <SettingRow title="Cuenta en la nube" description="Sincronizar entre dispositivos y compartir con tu equipo.">
        <Badge>Pronto</Badge>
      </SettingRow>
    </>
  );
}

/** Apariencia: look, mode, font, transcript width, language. */
export function AppearanceSection() {
  const mode = useNav((s) => s.mode);
  const look = usePrefs((s) => s.look);
  const font = usePrefs((s) => s.font);
  const width = usePrefs((s) => s.transcriptWidth);
  return (
    <>
      <SectionHead title="Apariencia" />
      <SettingRow title="Fuente de la interfaz" description="Menús, barras laterales y paneles.">
        <SegmentedControl
          size="sm"
          label="Fuente"
          value={font}
          onValueChange={(v) => setPrefs({ font: v === "mono" ? "mono" : "system" })}
          options={[
            { value: "system", label: "Sistema" },
            { value: "mono", label: "Mono" },
          ]}
        />
      </SettingRow>
      <SettingRow title="Ancho de la transcripción" description="Ancho máximo del chat y del cuadro de redacción.">
        <SegmentedControl
          size="sm"
          label="Ancho"
          value={width}
          onValueChange={(v) => setPrefs({ transcriptWidth: v === "narrow" || v === "wide" ? v : "medium" })}
          options={[
            { value: "narrow", label: "Estrecho" },
            { value: "medium", label: "Medio" },
            { value: "wide", label: "Ancho" },
          ]}
        />
      </SettingRow>
      <SettingRow title="Modo">
        <SegmentedControl
          size="sm"
          label="Modo"
          value={mode}
          onValueChange={(v) => go.setMode(v === "dark" ? "dark" : "light")}
          options={[
            { value: "light", label: "Claro" },
            { value: "dark", label: "Oscuro" },
          ]}
        />
      </SettingRow>
      <SettingRow title="Estilo" description="Minimal es v2. Clásico trae el verde y la tipografía de v1.">
        <SegmentedControl
          size="sm"
          label="Estilo"
          value={look}
          onValueChange={(v) => setPrefs({ look: v === "classic" ? "classic" : "minimal" })}
          options={[
            { value: "minimal", label: "Minimal" },
            { value: "classic", label: "Clásico v1" },
          ]}
        />
      </SettingRow>
      <SettingRow title="Idioma" description="El inglés llega pronto.">
        <SegmentedControl size="sm" label="Idioma" value="es" options={[{ value: "es", label: "Español" }]} />
      </SettingRow>
    </>
  );
}

const CHANNEL_COPY = {
  whatsapp: {
    name: "WhatsApp",
    tone: "brand",
    icon: <Icons.MessageCircle />,
    text: "Una cuenta vinculada por QR. No le contesta a nadie hasta que digas quién es, empezando por vos.",
  },
  telegram: {
    name: "Telegram",
    tone: "info",
    icon: <Icons.Send />,
    text: "Un bot de Telegram. Solo responde a los chats que apruebes.",
  },
  discord: {
    name: "Discord",
    tone: "violet",
    icon: <Icons.Users />,
    text: "Un bot en tu servidor, con permisos por rol.",
  },
} as const;

/** Canales: not wired to the core yet. */
export function ChannelSection({ channel }: { channel: keyof typeof CHANNEL_COPY }) {
  const c = CHANNEL_COPY[channel];
  return (
    <>
      <div className="channelcfg">
        <ProjectTile tone={c.tone} icon={c.icon} size={40} />
        <div className="channelcfg__text">
          <h2 className="config__title">{c.name}</h2>
          <p className="config__lead">{c.text}</p>
        </div>
      </div>
      <EmptyState variant="dashed" icon={<Icons.Clock />} title={`${c.name} llega pronto`}>
        Los canales se conectan en una próxima versión del core. Mientras tanto, escribile a tus agentes desde el Inbox.
      </EmptyState>
    </>
  );
}

/** Daemon y avanzado: where the panel is connected and which code the core runs. */
export function AdvancedSection() {
  const health = useData((s) => s.health);
  const connection = useData((s) => s.connection);
  useEffect(() => {
    void loadHealth();
  }, []);
  const rows: [string, string][] = health
    ? [
        ["Core", window.location.origin],
        ["Versión", health.version],
        ["Código (code_sha)", health.code_sha],
        ["Protocolo", String(health.protocol)],
        ["Instalación", health.home_id],
        ["Encendido hace", uptime(health.uptime_s)],
      ]
    : [["Core", window.location.origin]];
  return (
    <>
      <SectionHead
        title="Daemon y avanzado"
        lead="El core corre en esta computadora y es el único que guarda estado. El panel solo habla con él."
        actions={
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Icons.RefreshCw size={14} />}
            onClick={() => void loadHealth()}
          >
            Actualizar
          </Button>
        }
      />
      <dl className="kv">
        <div className="kv__row">
          <dt>Conexión</dt>
          <dd>
            <Badge tone={connection === "online" ? "brand" : connection === "offline" ? "danger" : "neutral"} dot>
              {connection === "online" ? "Conectado" : connection === "offline" ? "Sin conexión" : "Conectando"}
            </Badge>
          </dd>
        </div>
        {rows.map(([k, v]) => (
          <div key={k} className="kv__row">
            <dt>{k}</dt>
            <dd className="kv__mono">{v}</dd>
          </div>
        ))}
      </dl>
      {health ? (
        <div className="subsys">
          <h3 className="config__sub">Subsistemas</h3>
          {Object.entries(health.subsystems).map(([name, st]) => (
            <SettingRow key={name} title={name} description={st.detail}>
              <Badge tone={st.status === "ok" ? "brand" : st.status === "degraded" ? "warning" : "neutral"} dot>
                {st.status}
              </Badge>
            </SettingRow>
          ))}
        </div>
      ) : (
        <Skeleton shape="block" height={120} />
      )}
    </>
  );
}

function uptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
