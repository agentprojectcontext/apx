import { http, getToken } from "../http";
import { apiUrl } from "../net";

export type WhatsAppState = "off" | "connecting" | "pairing" | "connected" | "logged_out";

export interface WhatsAppStatus {
  running: boolean;
  enabled: boolean;
  auto_reply: boolean;
  reply_to_groups: boolean;
  /** The line itself, recorded when it connects. */
  self_jid?: string | null;
  /** The human who owns it — typed, never guessed from the line. */
  owner_jid: string | null;
  /** Other addresses that same human answers to (their LID), learned. */
  owner_alts?: string[];
  /** Tick when the paired line is the owner's own phone. Off by default. */
  self_is_owner?: boolean;
  contacts: number;
  state: WhatsAppState;
  qr_waiting: boolean;
  me: string | null;
  connected_at: string | null;
  last_error: string | null;
  session: string;
}

export interface WhatsAppContact {
  jid: string;
  /** The other addresses this same person arrives under (their LID). Learned,
   *  never typed — see senderAddresses in core/identity/whatsapp.js. */
  alts?: string[];
  name?: string;
  /** All four are owner-written and reach ONLY the turn that answers this
   *  person — never another contact's prompt. */
  nickname?: string;
  relationship?: string;
  bio?: string;
  rules?: string;
  role?: string;
  note?: string;
  /** Their WhatsApp profile picture, refreshed at most daily. Often absent —
   *  privacy settings hide it from people outside their contacts. */
  avatar_url?: string;
  /** What this conversation may do beyond answering. All off by default. */
  capabilities?: Record<string, boolean>;
  /** Text this person may be answered from without checking with the owner. */
  facts?: string;
  auto_reply?: boolean;
  first_seen?: string;
  last_seen?: string;
}

export interface WhatsAppSuggestion {
  id: string;
  kind: "appointment" | "errand";
  status: "pending" | "confirmed" | "dismissed";
  created_at: string;
  from_name: string;
  from_jid: string | null;
  summary: string;
  what: string;
  /** Their words about timing, never a resolved date. */
  when_text: string;
  urgent: boolean;
}

export interface WhatsAppSticker {
  key: string;
  meaning: string;
  meaning_source: "owner" | "vision";
  count?: number;
  last_seen?: string;
  senders?: string[];
  /** Whether the WebP was kept, and so whether it can be re-sent or shown. */
  has_image?: boolean;
  /** Understood on arrival as always, but never picked to send. */
  blocked?: boolean;
}

export interface WhatsAppPairResult {
  status: WhatsAppStatus;
  /** The raw QR payload. Null when there is nothing to scan. */
  qr: string | null;
  /** Ready-to-render PNG. Null when the `qrcode` optional dep is missing. */
  qr_data_url: string | null;
  note?: string;
}

export const WhatsApp = {
  status: () => http.get<WhatsAppStatus>("/api/whatsapp/status"),
  // Deliberately a POST, and deliberately not part of status(): a QR is a live
  // credential with a ~20s life, and whoever scans it owns the account. It is
  // handed out on an explicit request, never swept up by a polling panel.
  pair: () => http.post<WhatsAppPairResult>("/api/whatsapp/pair", {}),
  logout: () => http.post<WhatsAppStatus>("/api/whatsapp/logout", {}),
  clearOwner: () => http.del<{ ok: true }>("/api/whatsapp/owner"),
  settings: (body: Partial<Pick<WhatsAppStatus, "enabled" | "auto_reply" | "reply_to_groups">> & { owner_jid?: string; self_is_owner?: boolean }) =>
    http.patch<WhatsAppStatus>("/api/whatsapp/settings", body),
  send: (jid: string, text: string) =>
    http.post<{ ok: true; jid: string }>("/api/whatsapp/send", { jid, text }),

  contacts: {
    list: () => http.get<{ contacts: WhatsAppContact[]; roles: Record<string, { auto_reply: boolean }>; relationships: string[]; capabilities: string[] }>(
      "/api/whatsapp/contacts",
    ),
    patch: (jid: string, body: Partial<WhatsAppContact>) =>
      http.patch<WhatsAppContact>(`/api/whatsapp/contacts/${encodeURIComponent(jid)}`, body),
    remove: (jid: string) =>
      http.del<{ removed: boolean }>(`/api/whatsapp/contacts/${encodeURIComponent(jid)}`),
    /** "This row is me." Records whatever address they arrived under. */
    makeOwner: (jid: string) =>
      http.post<{ owner_jid: string; owner_alts: string[]; name: string }>(
        `/api/whatsapp/contacts/${encodeURIComponent(jid)}/owner`, {}),
  },

  suggestions: {
    list: () => http.get<{ suggestions: WhatsAppSuggestion[] }>("/api/whatsapp/suggestions"),
    confirm: (id: string, body?: { start?: string; minutes?: number; title?: string }) =>
      http.post<{ suggestion: WhatsAppSuggestion; booked: unknown }>(
        `/api/whatsapp/suggestions/${encodeURIComponent(id)}/confirm`, body || {}),
    dismiss: (id: string) =>
      http.post<{ suggestion: WhatsAppSuggestion }>(
        `/api/whatsapp/suggestions/${encodeURIComponent(id)}/dismiss`, {}),
  },

  stickers: {
    list: () => http.get<{ stickers: WhatsAppSticker[] }>("/api/whatsapp/stickers"),
    /**
     * The stored WebP as a blob URL.
     *
     * Not a plain `src`: the daemon requires a bearer token and an <img> cannot
     * carry a header, so a direct URL 401s and renders as alt text. Same shape
     * as fetchMediaUrl — and for the same reason, the token has no business in
     * a src attribute.
     */
    imageUrl: async (key: string): Promise<string | null> => {
      const token = getToken();
      const res = await fetch(apiUrl(`/api/whatsapp/stickers/${encodeURIComponent(key)}/image`), {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      return URL.createObjectURL(await res.blob());
    },
    rename: (key: string, meaning: string) =>
      http.patch<WhatsAppSticker>(`/api/whatsapp/stickers/${encodeURIComponent(key)}`, { meaning }),
    /** Keep the meaning, never pick it to send. */
    setBlocked: (key: string, blocked: boolean) =>
      http.patch<WhatsAppSticker>(`/api/whatsapp/stickers/${encodeURIComponent(key)}`, { blocked }),
    remove: (key: string) =>
      http.del<{ ok: boolean }>(`/api/whatsapp/stickers/${encodeURIComponent(key)}`),
  },
};
