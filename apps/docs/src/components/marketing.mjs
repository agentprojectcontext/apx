const downloads = [
  ["-mac-arm64.dmg", "macos", "arm64"],
  ["-mac-x64.dmg", "macos", "x64"],
  ["-win-x64.exe", "windows", "x64"],
  ["-linux-x86_64.AppImage", "linux", "x64"],
  ["-linux-arm64.AppImage", "linux", "arm64"],
  ["-android.apk", "android", "universal"],
];
const sources = new Set(["youtube", "github", "discord", "newsletter", "linkedin", "instagram", "google", "bing"]);
const mediums = new Set(["organic", "social", "video", "email", "referral"]);
const campaigns = new Set(["launch", "documentation", "comparisons"]);

/** Only the documented campaign vocabulary reaches Google; unknown query values never do. */
export function campaignParameters(search) {
  const query = new URLSearchParams(search);
  const parameters = {};
  for (const [key, allowed, output] of [
    ["utm_source", sources, "campaign_source"],
    ["utm_medium", mediums, "campaign_medium"],
    ["utm_campaign", campaigns, "campaign_name"],
  ]) {
    const value = query.get(key);
    if (allowed.has(value)) parameters[output] = value;
  }
  return parameters;
}

export function linkEvent(href, origin, placement = "content") {
  let url;
  try {
    url = new URL(href, origin);
  } catch {
    return;
  }
  if (!["http:", "https:"].includes(url.protocol)) return;
  if (url.origin === "https://github.com" && url.pathname.startsWith("/agentprojectcontext/apx/releases/")) {
    const asset = downloads.find(([suffix]) => url.pathname.endsWith(suffix));
    return asset
      ? { name: "download_click", parameters: { os: asset[1], architecture: asset[2], placement } }
      : { name: "cta_click", parameters: { action: "release_list", placement } };
  }
  if (url.origin !== origin) {
    const action =
      url.origin === "https://github.com" && url.pathname === "/agentprojectcontext/apx"
        ? "source_code"
        : url.origin === "https://discord.gg"
          ? "community"
          : undefined;
    return action ? { name: "cta_click", parameters: { action, placement } } : undefined;
  }
  if (url.hash === "#download") return { name: "cta_click", parameters: { action: "download_section", placement } };
  if (/\/(?:start\/(?:introduction|install)|devices\/server)\/$/.test(url.pathname))
    return { name: "cta_click", parameters: { action: "installation_guide", placement } };
  if (/\/compare\/(?:[a-z0-9-]+\/)?$/.test(url.pathname))
    return {
      name: "comparison_open",
      parameters: { destination: /\/compare\/$/.test(url.pathname) ? "index" : "article", placement },
    };
  if (["header", "footer"].includes(placement))
    return {
      name: "navigation_click",
      parameters: { destination: url.pathname.endsWith("/docs/") ? "guides" : "site", placement },
    };
}

function placementFor(element) {
  if (element.closest(".hero")) return "hero";
  if (element.closest("header, .web-header")) return "header";
  if (element.closest("footer, .web-footer")) return "footer";
  if (element.closest("#download")) return "downloads";
  if (element.closest(".getapx--docs")) return "docs";
  if (element.closest(".crew-card, .final")) return "final";
  return "content";
}

/** Install only after consent; the returned disposer also handles an in-place withdrawal. */
export function initializeMarketing(win, doc, send, enabled) {
  const emit = (name, parameters) => {
    if (enabled()) send(name, parameters);
  };
  const click = (event) => {
    const link = event.target?.closest?.("a[href]");
    if (!link || event.defaultPrevented) return;
    const item = linkEvent(link.href, win.location.origin, placementFor(link));
    if (item) emit(item.name, item.parameters);
  };
  const copied = (event) => {
    const button = event.target?.closest?.("[data-copy]");
    if (button) emit("install_copy", { placement: placementFor(button) });
  };
  doc.addEventListener("click", click);
  doc.addEventListener("apx:install-copied", copied);
  const end = doc.querySelector(".crew-card, .sl-markdown-content > :last-child");
  let observer;
  let completed = false;
  if (end && win.IntersectionObserver) {
    observer = new win.IntersectionObserver(
      (entries) => {
        if (completed || !enabled() || !entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5))
          return;
        completed = true;
        emit("article_complete", { content_type: doc.querySelector(".compare") ? "comparison" : "guide" });
        observer.disconnect();
      },
      { threshold: 0.5 },
    );
    observer.observe(end);
  }
  return () => {
    doc.removeEventListener("click", click);
    doc.removeEventListener("apx:install-copied", copied);
    observer?.disconnect();
  };
}
