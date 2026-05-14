export const Flag: Record<string, boolean> = new Proxy({} as Record<string, boolean>, {
  get: () => false,
})
