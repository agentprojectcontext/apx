// UI strings, Spanish (voseo): los artefactos que Archivos muestra junto a los archivos de los chats.
import type { enFilesArtifacts } from "./files-artifacts-en.ts";

export const esFilesArtifacts: Record<keyof typeof enFilesArtifacts, string> = {
  "files.kind.artifact": "Artefactos",
  "files.artifacts.lead":
    "Los widgets, apps y páginas web que hicieron tus agentes, abiertos o cerrados. Abrí uno de nuevo o andá a su chat.",
  "files.artifacts.empty": "Todavía no hay artefactos",
  "files.artifacts.emptyText": "Los widgets, apps y páginas web que hace un agente aparecen acá, aunque los cierres.",
  "files.artifacts.emptySearch": "No hay ningún artefacto con ese nombre",
  "files.artifacts.emptyProject": "Este proyecto no tiene artefactos",
  "files.artifacts.open": "Abrir {title}",
};
