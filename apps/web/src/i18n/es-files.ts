// UI strings, Spanish (voseo): los archivos de un proyecto, solo lectura.
import type { MessageKey } from "./en.ts";

export const esFiles: Partial<Record<MessageKey, string>> = {
  "files.tree": "Archivos del proyecto",
  "files.repo": "Repositorio",
  "files.none": "Elegí un archivo",
  "files.noneBody": "Su texto aparece acá. El Markdown se lee como página, como fuente o las dos cosas.",
  "files.noFolder": "Sin carpeta en esta máquina",
  "files.noFolderBody": "Este proyecto no tiene carpeta en esta máquina; no hay nada para recorrer.",
  "files.more": "Hay más archivos de los que se muestran.",
  "files.emptyFolder": "La carpeta está vacía.",
  "files.mode": "Cómo mostrarlo",
  "files.mode.view": "Vista",
  "files.mode.source": "Fuente",
  "files.mode.split": "Dividido",
  "files.binary": "No es un archivo de texto",
  "files.binaryBody": "Abrilo desde la carpeta con su aplicación.",
  "files.truncated": "Se muestran solo los primeros 256 KB.",
};
