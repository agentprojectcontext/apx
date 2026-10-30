export const measurementId = "G-BZT6ME07J4";
export const consentKey = "apx-website-analytics-v1";
export const denialCookie = "apx_analytics_denied";

export function pageLocation(location, builtPath = "/") {
  return `${location.origin}${builtPath}`;
}

export function initializeConsent(win, doc) {
  const root = doc.querySelector("[data-analytics-consent]");
  if (!root || root.dataset.ready) return;
  root.dataset.ready = "true";
  // Keep the fixed controls outside Starlight's content stacking context.
  doc.body.append(root);
  const panel = root.querySelector("[data-cookie-panel]");
  const settings = root.querySelector("[data-cookie-settings]");
  const accept = root.querySelector("[data-cookie-accept]");
  const reject = root.querySelector("[data-cookie-reject]");
  const error = root.querySelector("[data-cookie-error]");
  let loaded = false;
  let pendingDecline = false;
  let channel;
  try {
    channel = new win.BroadcastChannel(consentKey);
  } catch {}
  function readCookies() {
    try {
      return doc.cookie;
    } catch {
      return "";
    }
  }
  function writeCookie(value) {
    try {
      doc.cookie = value;
    } catch {}
  }
  function readChoice() {
    if (
      readCookies()
        .split(";")
        .some((cookie) => cookie.trim() === `${denialCookie}=1`)
    )
      return "declined";
    try {
      // A readable but unwritable store must not resurrect an old acceptance.
      const probe = crypto.randomUUID();
      win.localStorage.setItem(`${consentKey}-check`, probe);
      if (win.localStorage.getItem(`${consentKey}-check`) !== probe) return;
      win.localStorage.removeItem(`${consentKey}-check`);
      return win.localStorage.getItem(consentKey);
    } catch {}
  }
  const choice = readChoice();

  function start() {
    if (loaded) return;
    loaded = true;
    win[`ga-disable-${measurementId}`] = false;
    win.dataLayer = win.dataLayer || [];
    const gtag = function () {
      win.dataLayer.push(arguments);
    };
    gtag("js", new Date());
    gtag("config", measurementId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: pageLocation(win.location, root.dataset.analyticsPath),
      page_referrer: "",
      page_title: "APX website",
      cookie_expires: 31536000,
      cookie_update: false,
    });
    gtag("event", "page_view", {
      page_location: pageLocation(win.location, root.dataset.analyticsPath),
      page_referrer: "",
      page_title: "APX website",
    });
    const script = doc.createElement("script");
    script.async = true;
    script.referrerPolicy = "no-referrer";
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    doc.head.append(script);
  }

  function clearCookies() {
    for (const cookie of readCookies().split(";")) {
      const name = cookie.split("=")[0].trim();
      if (name !== "_ga" && !name.startsWith("_ga_")) continue;
      const parts = win.location.hostname.split(".");
      const domains = ["", ...parts.map((_, i) => `; domain=${parts.slice(i).join(".")}`)];
      for (const domain of domains) writeCookie(`${name}=; Max-Age=0; path=/${domain}; SameSite=Lax`);
    }
  }

  function persist(value) {
    const maxAge = value === "declined" ? 31536000 : 0;
    writeCookie(
      `${denialCookie}=1; Max-Age=${maxAge}; path=/; SameSite=Lax${win.location.protocol === "https:" ? "; Secure" : ""}`,
    );
    try {
      win.localStorage.setItem(consentKey, value);
    } catch {
      try {
        win.localStorage.removeItem(consentKey);
      } catch {}
    }
    return readChoice() === value;
  }

  function stop() {
    win[`ga-disable-${measurementId}`] = true;
    clearCookies();
  }

  function decline() {
    stop();
    pendingDecline = !persist("declined");
    error.hidden = !pendingDecline;
    panel.hidden = !pendingDecline;
    settings.hidden = pendingDecline;
    // Only reload when a fresh page can read the denial.
    if (loaded && !pendingDecline) win.location.reload();
  }

  function choose(value) {
    if (value === "declined") {
      decline();
      try {
        channel?.postMessage("declined");
      } catch {}
      if (!pendingDecline) settings.focus();
      return;
    }
    pendingDecline = false;
    persist(value);
    error.hidden = true;
    panel.hidden = true;
    settings.hidden = false;
    settings.focus();
    if (loaded) win.location.reload();
    else start();
  }

  function synchronize() {
    if (pendingDecline) decline();
    else if (loaded && readChoice() !== "accepted") decline();
  }
  if (channel)
    channel.onmessage = (event) => {
      if (event.data === "declined") decline();
    };
  doc.addEventListener("visibilitychange", synchronize);
  win.addEventListener("storage", (event) => {
    if (event.key === consentKey || event.key === null) synchronize();
  });
  win.addEventListener("pageshow", synchronize);
  settings.addEventListener("click", () => {
    settings.hidden = true;
    panel.hidden = false;
    reject.focus();
  });
  accept.addEventListener("click", () => choose("accepted"));
  reject.addEventListener("click", () => choose("declined"));
  panel.hidden = choice === "accepted" || choice === "declined";
  settings.hidden = !panel.hidden;
  if (choice === "accepted") start();
  else {
    win[`ga-disable-${measurementId}`] = true;
    clearCookies();
  }
}
