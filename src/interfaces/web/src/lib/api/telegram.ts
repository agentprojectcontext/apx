import { http } from "../http";
import type {
  TelegramChannel,
  TelegramChannelsResponse,
  TelegramContact,
  TelegramContactsResponse,
  TelegramRole,
} from "../../types/daemon";

export interface TelegramStatus {
  enabled: boolean;
  channels?: number;
  last_update_id?: number;
}

export interface TelegramSendBody {
  text: string;
  chat_id?: string;
  channel?: string;
}

export const Telegram = {
  channels: {
    list:   () => http.get<TelegramChannelsResponse>("/telegram/channels"),
    upsert: (ch: TelegramChannel) =>
      http.post<{ channel: TelegramChannel; created: boolean }>("/telegram/channels", ch),
    patch:  (name: string, body: Partial<TelegramChannel>) =>
      http.patch<{ ok: true; channel: TelegramChannel }>(`/telegram/channels/${name}`, body),
    remove: (name: string) =>
      http.del<void>(`/telegram/channels/${encodeURIComponent(name)}`),
  },
  contacts: {
    list:   () => http.get<TelegramContactsResponse>("/telegram/contacts"),
    patch:  (userId: number | string, body: Partial<TelegramContact>) =>
      http.patch<{ ok: true; contact: TelegramContact }>(
        `/telegram/contacts/${encodeURIComponent(String(userId))}`,
        body,
      ),
    remove: (userId: number | string) =>
      http.del<void>(`/telegram/contacts/${encodeURIComponent(String(userId))}`),
  },
  roles: {
    list:   () => http.get<{ roles: Record<string, TelegramRole> }>("/telegram/roles"),
    set:    (name: string, tools: "*" | string[]) =>
      http.put<{ ok: true; name: string; role: TelegramRole }>(
        `/telegram/roles/${encodeURIComponent(name)}`,
        { tools },
      ),
    remove: (name: string) =>
      http.del<void>(`/telegram/roles/${encodeURIComponent(name)}`),
  },
  status: () => http.get<TelegramStatus>("/telegram/status"),
  start:  () => http.post<{ ok: true; status: TelegramStatus }>("/telegram/start"),
  stop:   () => http.post<{ ok: true; status: TelegramStatus }>("/telegram/stop"),
  send:   (body: TelegramSendBody) =>
    http.post<{ ok: true; message_id: number }>("/telegram/send", body),
};
