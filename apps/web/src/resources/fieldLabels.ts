import type { SecretInfo } from "@apx/protocol";
import type { MessageKey } from "../i18n/index.ts";

/** What a stored variable goes in as: a username, a password, a one-time code, or both (a sign-in). */
export const FIELD_LABEL = {
  username: "res.field.username",
  password: "res.field.password",
  otp: "res.field.otp",
  login: "res.field.login",
} as const satisfies Record<NonNullable<SecretInfo["field"]>, MessageKey>;
