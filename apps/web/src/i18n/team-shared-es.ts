// The team strings other screens use too: they load with the first screen; the rest is the "team" pack.
import type { MessageKey } from "./en.ts";

export const esTeamShared: Partial<Record<MessageKey, string>> = {
  "team.new.title": "Nuevo agente",
  "team.new.badName": "El nombre necesita al menos una letra.",
  "team.import.error": "No se pudo importar: {error}",
};
