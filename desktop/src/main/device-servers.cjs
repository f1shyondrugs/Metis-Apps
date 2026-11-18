const { normalizeServer } = require("../../policy.cjs");

function deviceServerRows(recent, config, status, hostname) {
  const rows = new Map();
  let pairedOrigin;
  try { if (config?.server) pairedOrigin = new URL(normalizeServer(config.server)).origin; } catch { /* No valid pairing. */ }
  function append(value) {
    try {
      const url = normalizeServer(value);
      const { origin, host } = new URL(url);
      if (rows.has(origin)) return;
      const paired = origin === pairedOrigin;
      const connection = status.accessMismatch ? "paused" :
        ["online", "connecting", "offline", "error"].includes(status.connection) ? status.connection : "offline";
      rows.set(origin, { origin, url, host, paired,
        deviceName: paired ? hostname : "", status: paired ? connection : "not-paired" });
    } catch { /* Invalid history entries never become actions. */ }
  }
  // Keep the actual paired server visible even after its history entry ages out.
  if (pairedOrigin) append(recent.find(entry => {
    try { return new URL(entry.url).origin === pairedOrigin; } catch { return false; }
  })?.url || pairedOrigin);
  for (const entry of recent.slice(0, 10)) append(entry.url);
  return [...rows.values()];
}

module.exports = { deviceServerRows };
