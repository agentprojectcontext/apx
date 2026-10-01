import { useEffect, useState } from "react";
import { mediaUrl } from "../../data/media.ts";

/** The object URL of a media file APX made, once it has loaded. */
export function useMediaUrl(id: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!id) return;
    let live = true;
    mediaUrl(id).then(
      (u) => live && setUrl(u),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}
