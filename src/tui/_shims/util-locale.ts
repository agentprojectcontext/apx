export const Locale = {
  format: (n: number) => String(n),
  number: (n: number) => n.toLocaleString(),
  titlecase: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
  truncateMiddle: (s: string, maxLen: number): string => {
    if (s.length <= maxLen) return s
    const half = Math.floor((maxLen - 3) / 2)
    return s.slice(0, half) + "..." + s.slice(s.length - half)
  },
}
