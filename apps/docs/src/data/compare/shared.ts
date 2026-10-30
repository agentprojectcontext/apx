export type Lang = "en" | "es";
export type Copy = { en: string; es: string };
export type Source = { title: string; url: string };
export const text = (en: string, es: string): Copy => ({ en, es });

/** One product compared with APX. `rows` and `rowSources` follow `topics`, in order. */
export type Product = {
  slug: string;
  name: string;
  logo: string;
  /** A one-color mark drawn in black, inverted in the dark theme. */
  mono?: boolean;
  source: string;
  detailSource: string;
  license: string;
  sources: Source[];
  rowSources: string[][];
  /** A few words for the product's way of working, beside its name. */
  short: Copy;
  tagline: Copy;
  intro: Copy;
  choice: Copy;
  rows: Copy[];
  detail: Copy;
  tryIt: Copy;
};
