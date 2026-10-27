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
  name,
  size,
}: {
  personId: string | undefined;
  fallback: ReactNode;
  className?: string;
  name?: string;
  size?: number;
}) {
  const [picture, setPicture] = useState<{ person: string; src: string }>();
  const src = picture?.person === personId ? picture?.src : undefined;
  useEffect(() => {
    let live = true;
    setPicture(undefined);
    if (personId)
      void pictureOf(personId).then((url) => live && setPicture(url ? { person: personId, src: url } : undefined));
    return () => {
      live = false;
    };
  }, [personId]);
  return (
    <span
      className={`${className}${src ? " has-picture" : ""}`}
      {...(name ? { role: "img", "aria-label": name } : {})}
      style={
        size
          ? { width: size, height: size, display: "inline-flex", flex: "none", overflow: "hidden", borderRadius: "50%" }
          : undefined
      }
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="chan__avatarimg"
          style={size ? { width: size, height: size, objectFit: "cover" } : undefined}
          onError={() => setPicture(undefined)}
        />
      ) : (
        <span aria-hidden={name ? true : undefined}>{fallback}</span>
      )}
    </span>
  );
}
