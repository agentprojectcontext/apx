export const Binary = {
  search<T>(arr: T[], id: string, fn: (item: T) => string): { found: boolean; index: number } {
    let lo = 0, hi = arr.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const v = fn(arr[mid])
      if (v === id) return { found: true, index: mid }
      if (v < id) lo = mid + 1
      else hi = mid
    }
    return { found: false, index: lo }
  },
}
