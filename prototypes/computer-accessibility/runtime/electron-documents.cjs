function document(label, iframe = false) {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src data:">
<title>Acme same title</title><h1>Fixture ${label}</h1><button>Increment ${label}</button>
<input aria-label="SYNTHETIC_ORDINARY_LABEL" value="SYNTHETIC_ORDINARY_VALUE">
<input type="password" aria-label="SYNTHETIC_SECURE_LABEL" value="SYNTHETIC_REDACTION_SENTINEL">
${iframe ? '<iframe src="data:text/html,SYNTHETIC_IFRAME_SENTINEL"></iframe>' : ""}`;
}
function fixtureURL(label, iframe = false) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(document(label, iframe))}`;
}
module.exports = { fixtureURL, document };
