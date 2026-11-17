import type { AppointmentMode } from "@apx/protocol";
import type { MessageKey } from "../i18n/index.ts";

/** What happens to an appointment a contact asks for, in the order the screens offer it. */
export const APPOINTMENT_MODES = ["off", "note", "book"] as const satisfies readonly AppointmentMode[];
export const APPOINTMENT_LABEL: Record<AppointmentMode, MessageKey> = {
  off: "ch.appt.off",
  note: "ch.appt.note",
  book: "ch.appt.book",
};
