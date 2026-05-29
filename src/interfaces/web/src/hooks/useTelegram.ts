import useSWR from "swr";
import { Telegram } from "../lib/api";
import { REFRESH } from "../constants";

export function useTelegramStatus() {
  const { data, error, isLoading, mutate } = useSWR(
    "/telegram/status",
    () => Telegram.status(),
    { refreshInterval: REFRESH.telegramStatus },
  );
  return { status: data, error, isLoading, mutate };
}

export function useTelegramChannels() {
  const { data, error, isLoading, mutate } = useSWR(
    "/telegram/channels",
    () => Telegram.channels.list(),
  );
  return { channels: data?.channels || [], error, isLoading, mutate };
}

export function useTelegramContacts() {
  const { data, error, isLoading, mutate } = useSWR(
    "/telegram/contacts",
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
