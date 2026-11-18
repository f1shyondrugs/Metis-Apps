const { normalizeServer } = require("../../policy.cjs");

function pairingOrigin(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim()) || /[\u0000-\u001f\u007f\\]/.test(value)) throw Error('Enter a valid server address.');
  return new URL(normalizeServer(value)).origin;
}

function validField(value, limit) {
  return typeof value === "string" && value.length > 0 && value.length <= limit && !/\s|[\u0000-\u001f\u007f]/.test(value);
}

function validatePairing(value) {
  if (!value || !["user", "admin"].includes(value.permissionMode) ||
      !validField(value.clientId, 256) || !validField(value.credential, 8192)) {
    throw new Error("Invalid device pairing data.");
  }
  return { server: pairingOrigin(value.server), clientId: value.clientId,
    credential: value.credential, permissionMode: value.permissionMode };
}

async function enroll(input, device, { signal, authorize, fetcher = fetch } = {}) {
  const server = pairingOrigin(input?.server);
  const token = typeof input?.token === "string" ? input.token.trim() : "";
  if (!validField(token, 512)) throw new Error("Enter a valid pairing code from Metis.");
  const permissionMode = token.startsWith("a_") ? "admin" : "user";
  signal?.throwIfAborted();
  await authorize?.(permissionMode);
  signal?.throwIfAborted();
  const response = await fetcher(server + "/api/remote-clients/enroll", {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/json" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    body: JSON.stringify({ ...device, token, permissionMode,
      capabilities: [
        "user_files", "user_processes", "user_directories",
        ...(permissionMode === "admin" ? ["system_files", "services", "disks", "admin_processes"] : []),
        ...(device.desktopAvailable ? ["desktop_gui"] : []),
      ] }),
  });
  if (response.status >= 300 && response.status < 400) throw new Error("Pairing endpoint redirected. Enter the server’s final origin.");
  if (!response.ok) throw new Error(`Pairing failed (HTTP ${response.status}). Check the code and try again.`);
  const data = await response.json();
  if (data?.client?.permissionMode !== permissionMode) {
    throw new Error("The server returned a different access mode. Pairing was stopped.");
  }
  return validatePairing({ server, clientId: data.client.id, credential: data.credential, permissionMode });
}

async function fetchPairingSnapshot(config) {
  const response = await fetch(config.server + "/api/remote-clients/hub", {
    redirect: "error",
    headers: { "x-metis-client-id": config.clientId, Authorization: `Bearer ${config.credential}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Hub request failed (HTTP ${response.status}).`);
  const data = await response.json();
  if (data?.client?.id !== config.clientId) throw new Error("The server returned another device.");
  return { client: data.client, audit: Array.isArray(data.audit) ? data.audit.filter(entry => entry?.clientId === config.clientId) : [] };
}

module.exports = { pairingOrigin, validatePairing, enroll, fetchPairingSnapshot };
