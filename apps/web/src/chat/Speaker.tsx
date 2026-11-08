import type { ReactNode } from "react";
import { PersonAvatar } from "../channels/PersonAvatar.tsx";
import { initialsOf } from "../data/prefs.ts";

/**
 * Who speaks next, in a chat with several speakers (a group, a channel's room or contact): their face and name over
 * their words. What they said follows at the left, under the name.
 */
export function Speaker({ face, name }: { face: ReactNode; name: ReactNode }) {
  return (
    <div className="transcript__speaker">
      <span className="transcript__speakerface">{face}</span>
      <span className="transcript__speakername">{name}</span>
    </div>
  );
}

/** A person's face: their picture on their channel when there is one, else their initials on a quiet circle. */
export function PersonFace({ id, name }: { id?: string | undefined; name: string }) {
  return <PersonAvatar personId={id} fallback={initialsOf(name)} className="transcript__face" size={24} />;
}
