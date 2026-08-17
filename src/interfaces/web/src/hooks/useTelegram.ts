import useSWR from "swr";
import { Telegram } from "../lib/api";
import { REFRESH } from "../constants";

export function useTelegramStatus() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/telegram/status",
    () => Telegram.status(),
    { refreshInterval: REFRESH.telegramStatus },
  );
  return { status: data, error, isLoading, mutate };
}

export function useTelegramChannels() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/telegram/channels",
    () => Telegram.channels.list(),
  );
  return { channels: data?.channels || [], error, isLoading, mutate };
}

export function useTelegramContacts() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/telegram/contacts",
    () => Telegram.contacts.list(),
  );
  return {
    contacts: data?.contacts || [],
    roles: data?.roles || {},
    channelOwners: data?.channel_owners || [],
    error,
    isLoading,
    mutate,
  };
}
