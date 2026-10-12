// A link an agent writes to send the owner somewhere in the app, [Config › Desktop](apx:settings/desktop): the panel
// shows it as a button that goes there; anywhere else (a channel message) only its label is left.

export const APP_LINK_SCHEME = "apx:";

/** The text with every app link reduced to its label, for places that cannot follow one. */
export function withoutAppLinks(text: string): string {
  return text.replace(/\[([^\]\n]+)\]\(apx:[^)\s]*\)/gi, "$1");
}
