// The desktop app opens the panel with ?welcome=installed right after its first run: the setup's welcome says APX is
// installed. Read once, then dropped from the address so a reload or a later setup does not say it again.
const query = new URLSearchParams(window.location.search);

export const JUST_INSTALLED = query.get("welcome") === "installed";

if (query.has("welcome")) {
  query.delete("welcome");
  const rest = query.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`,
  );
}
