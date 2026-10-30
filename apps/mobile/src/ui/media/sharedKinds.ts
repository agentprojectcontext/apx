import type { Key } from "../../i18n";
import type { SharedKind } from "../../protocol";
import type { IconName } from "../Icon";

/** A file of each kind, when it has no name of its own. */
export const ONE: Record<SharedKind, Key> = {
  image: "sharedImage",
  video: "sharedVideo",
  audio: "sharedAudioOne",
  document: "sharedDocument",
};

export const KIND_ICON: Record<SharedKind, IconName> = {
  image: "Image",
  video: "Video",
  audio: "Music",
  document: "FileText",
};
