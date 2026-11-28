/** A host path is meaningful only for the currently selected local connection. */
export function createHostFilePicker(pick: () => Promise<string | undefined>) {
  let local = false;
  let revision = 0;
  return {
    connect(isLocal: boolean) {
      local = isLocal;
      revision++;
    },
    available: () => local,
    async pick() {
      if (!local) return undefined;
      const current = revision;
      const file = await pick();
      return local && revision === current ? file : undefined;
    },
  };
}
