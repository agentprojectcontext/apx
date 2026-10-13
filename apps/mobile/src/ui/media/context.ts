import { createContext, useContext, useEffect, useState } from "react";
import type { MediaItem } from "../../chat/media";
import { mediaFile } from "../../chat/mediaFiles";
import type { ApxClient } from "../../protocol";

/** The chat's client, for the pictures, videos and sounds in its messages to fetch their bytes. */
export const MediaClient = createContext<ApxClient | undefined>(undefined);

export function useMediaClient(): ApxClient {
  const client = useContext(MediaClient);
  if (!client) throw new Error("MediaClient missing");
  return client;
}

/** The item's local file once `load` is true: undefined while it comes, an error when it could not. */
export function useMediaUri(item: MediaItem, load = true): { uri?: string; error?: string } {
  const client = useMediaClient();
  const [state, setState] = useState<{ uri?: string; error?: string }>({});
  useEffect(() => {
    if (!load) return;
    let live = true;
    mediaFile(client, item).then(
      (uri) => live && setState({ uri }),
      (error: unknown) => live && setState({ error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      live = false;
    };
  }, [client, item, load]);
  return state;
}
