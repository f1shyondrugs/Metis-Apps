const { normalizeServer } = require("../../policy.cjs");

function deviceServerRows(recent, sessions, hostname) {
  const rows = new Map();
  const history = new Map();
  for (const entry of recent.slice(0, 10)) {
    try {
      const url = normalizeServer(entry.url);
      const { origin } = new URL(url);
      if (!history.has(origin)) history.set(origin, url);
    } catch { /* Invalid history entries never become actions. */ }
  }
  for (const [origin, session] of sessions) {
    const { host } = new URL(origin);
    const { config, status } = session;
    rows.set(origin, { origin, url: history.get(origin) || origin, host, paired: true,
      deviceName: hostname, status: status.accessMismatch ? "paused" : status.connection,
      connection: status.connection, accessMismatch: Boolean(status.accessMismatch), revision: session.revision,
      error: status.error || "", clientId: config?.clientId || "",
      permissionMode: config?.permissionMode || null, deviceElevation: status.deviceElevation || null });
  }
  for (const [origin, url] of history) {
    if (!rows.has(origin)) rows.set(origin, { origin, url, host: new URL(origin).host,
      paired: false, deviceName: "", status: "not-paired" });
  }
  return [...rows.values()];
}

module.exports = { deviceServerRows };
