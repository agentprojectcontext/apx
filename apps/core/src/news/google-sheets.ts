import type { NewsEntry } from "./entries.ts";

export const GOOGLE_SHEETS_NEWS: NewsEntry = {
  id: "google-sheets",
  since: "2.16.0",
  title: { en: "Work with your Google spreadsheets", es: "Trabajá con tus planillas de Google" },
  about: {
    en: "Your agent can list tabs, read selected cells and create spreadsheets through your Drive connection. Replacing cells asks you first.",
    es: "Tu agente puede listar pestañas, leer celdas y crear planillas con tu conexión de Drive. Reemplazar celdas te pregunta primero.",
  },
  applies: (facts) => facts.google.drive,
  text: "The connected Google Drive account now offers sheets_tabs, sheets_read, sheets_create and sheets_write through tool_search. Offer to inspect a spreadsheet the owner chooses or create one. Use drive_search with kind sheet to find it, list its exact tab names, then read a bounded A1 rectangle. Existing Google permissions and account/project switches still apply; the owner's own client can read all Drive, while writes stay app-file scoped. With their own OAuth project, the owner must enable the Google Sheets API. Replacing cells requires owner confirmation; RAW values never execute formulas. No formatting, append, automatic sharing or background sync. Existing Docs reading and whole-text writing remain in the Drive tools. Do not claim a CSV read covers the whole workbook or retry a write with an uncertain outcome.",
  actions: [
    {
      label: { en: "Read a spreadsheet", es: "Consultar una planilla" },
      prompt: "Help me choose a Google spreadsheet and read a specific tab and cell range without changing it.",
    },
  ],
};
