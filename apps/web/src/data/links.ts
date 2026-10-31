// Where APX lives outside the app: the community, the code and the guides.
export const LINKS = {
  discord: "https://discord.gg/vxdZuT5WuE",
  // The public repo: where the releases and the docs live.
  repo: "https://github.com/agentprojectcontext/apx",
  releases: "https://github.com/agentprojectcontext/apx/releases",
  feedback: "https://github.com/agentprojectcontext/apx/issues/new/choose",
  docs: "https://apxagent.app/",
} as const;

/** The guides in the panel's language (the docs site has English and Spanish). */
export const guidesUrl = (lang: string): string => `${LINKS.docs}${lang === "es" ? "es/" : ""}start/first-steps/`;

export const openLink = (url: string): void => void window.open(url, "_blank", "noopener,noreferrer");
