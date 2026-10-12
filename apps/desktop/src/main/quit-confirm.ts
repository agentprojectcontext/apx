// Asks before APX quits: its agents' browser tabs close and, when this app runs the core, so do the crew's routines
// and channels. Closing the window never asks: it only hides it.
import { type BaseWindow, dialog } from "electron";

const TEXT = {
  en: {
    message: "Quit APX?",
    tabs: "The browser tabs your agents use close.",
    core: "Your crew stops too: routines and channels wait until you open APX again.",
    quit: "Quit",
    cancel: "Cancel",
  },
  es: {
    message: "¿Salir de APX?",
    tabs: "Se cierran las pestañas del navegador que usan tus agentes.",
    core: "Tu crew también se frena: las rutinas y los canales esperan hasta que abras APX de nuevo.",
    quit: "Salir",
    cancel: "Cancelar",
  },
};

export function confirmQuit(win: BaseWindow, opts: { es: boolean; runsCore: boolean }): boolean {
  const text = opts.es ? TEXT.es : TEXT.en;
  const answer = dialog.showMessageBoxSync(win, {
    type: "question",
    message: text.message,
    detail: opts.runsCore ? `${text.tabs} ${text.core}` : text.tabs,
    buttons: [text.quit, text.cancel],
    defaultId: 0,
    cancelId: 1,
  });
  return answer === 0;
}
