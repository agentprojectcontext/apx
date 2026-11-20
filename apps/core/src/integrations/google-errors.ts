export type GoogleAccessCode = "not_connected" | "sign_in_required" | "response_too_large" | "api_disabled";

/** A Google API turned off in the OAuth client's Cloud project, and whose project that is. */
export type DisabledApi = { service?: string; link?: string; client: "apx" | "own" };

const API_NAMES: Record<string, string> = {
  "sheets.googleapis.com": "Google Sheets API",
  "drive.googleapis.com": "Google Drive API",
  "docs.googleapis.com": "Google Docs API",
  "gmail.googleapis.com": "Gmail API",
  "calendar-json.googleapis.com": "Google Calendar API",
};

function disabledMessage(label: string, off: DisabledApi): string {
  const api = (off.service && API_NAMES[off.service]) ?? off.service ?? `The Google API ${label} uses`;
  if (off.client === "apx")
    return `${api} is turned off in APX's Google project, so ${label} cannot do this for now. Nothing in the owner's account or settings fixes it: APX has to turn it on.`;
  return off.link
    ? `${api} is turned off in the Google Cloud project of the owner's own client. Turn it on at ${off.link}, wait a few minutes and try again.`
    : `${api} is turned off in the Google Cloud project of the owner's own client. Turn it on in Google Cloud Console, wait a few minutes and try again.`;
}

/** Locally generated account/transport failures, distinct from remote API message text. */
export class GoogleAccessError extends Error {
  readonly code: GoogleAccessCode;
  constructor(code: GoogleAccessCode, label = "Google", off?: DisabledApi) {
    const messages = {
      not_connected: `${label} is not connected; connect it in Resources › Integrations`,
      sign_in_required: `Google no longer accepts the sign-in of ${label}; sign in again in Integrations`,
      response_too_large: "Google response exceeds the size limit; choose a smaller range",
      api_disabled: disabledMessage(label, off ?? { client: "own" }),
    };
    super(messages[code]);
    this.code = code;
  }
}

/**
 * Google's structured "this API is off in the client's project" answer. Only a service host and project number that
 * match their exact shapes are kept, and the console link is built here: none of Google's free text passes through.
 */
export function disabledApi(body: unknown): { service?: string; link?: string } | undefined {
  const error = (body as { error?: unknown } | null)?.error;
  if (!error || typeof error !== "object") return undefined;
  const { details, errors } = error as { details?: unknown; errors?: unknown };
  const info = Array.isArray(details)
    ? (details as Array<Record<string, unknown>>).find(
        (d) => d?.["@type"] === "type.googleapis.com/google.rpc.ErrorInfo" && d.reason === "SERVICE_DISABLED",
      )
    : undefined;
  const legacy =
    Array.isArray(errors) &&
    (errors as Array<Record<string, unknown>>).some((e) => e?.reason === "accessNotConfigured");
  if (!info && !legacy) return undefined;
  const meta = (info?.metadata ?? {}) as Record<string, unknown>;
  const service =
    typeof meta.service === "string" && /^[a-z0-9-]{1,63}\.googleapis\.com$/.test(meta.service)
      ? meta.service
      : undefined;
  const project = typeof meta.consumer === "string" ? /^projects\/(\d{1,20})$/.exec(meta.consumer)?.[1] : undefined;
  return {
    ...(service ? { service } : {}),
    ...(service && project
      ? { link: `https://console.developers.google.com/apis/api/${service}/overview?project=${project}` }
      : {}),
  };
}
