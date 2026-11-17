export type GoogleAccessCode = "not_connected" | "sign_in_required" | "response_too_large";

/** Locally generated account/transport failures, distinct from remote API message text. */
export class GoogleAccessError extends Error {
  readonly code: GoogleAccessCode;
  constructor(code: GoogleAccessCode, label = "Google") {
    const messages = {
      not_connected: `${label} is not connected; connect it in Resources › Integrations`,
      sign_in_required: `Google no longer accepts the sign-in of ${label}; sign in again in Integrations`,
      response_too_large: "Google response exceeds the size limit; choose a smaller range",
    };
    super(messages[code]);
    this.code = code;
  }
}
