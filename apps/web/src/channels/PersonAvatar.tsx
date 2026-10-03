import { type ReactNode, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { mediaUrl } from "../data/media.ts";

/** One question per person for the page's life: the core keeps the picture a day and asks the channel after that. */
const asked = new Map<string, Promise<string | undefined>>();
const pictureOf = (person: string): Promise<string | undefined> => {
  let p = asked.get(person);
  if (!p) {
    p = client
      .call("contacts.avatar", { person })
      .then((r) => (r.media_id ? mediaUrl(r.media_id) : undefined))
      .catch(() => undefined);
    asked.set(person, p);
  }
  return p;
};

/**
 * A person's face on their channel (the profile picture they show on WhatsApp or Telegram), or `fallback` (their
 * initials) while it loads or when they show none.
 */
export function PersonAvatar({
  personId,
  fallback,
  className = "chan__avatar",
}: {
  personId: string | undefined;
  fallback: ReactNode;
  className?: string;
}) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true;
    setSrc(undefined);
    if (personId) void pictureOf(personId).then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [personId]);
  return (
    <span className={`${className}${src ? " has-picture" : ""}`}>
      {src ? <img src={src} alt="" className="chan__avatarimg" /> : fallback}
    </span>
  );
}
