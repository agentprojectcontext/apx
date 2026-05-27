export const Provider = {
  parseModel: (model: string) => {
    const parts = model.split(":")
    if (parts.length >= 2) return { providerID: parts[0], modelID: parts.slice(1).join(":") }
    // Also support slash separator
    const slashParts = model.split("/")
    if (slashParts.length >= 2) return { providerID: slashParts[0], modelID: slashParts.slice(1).join("/") }
    return { providerID: null, modelID: model }
  },
}
