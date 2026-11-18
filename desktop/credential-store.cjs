const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pairingOrigin, validatePairing } = require("./src/main/device-pairing.cjs");

function createCredentialStore({ file, safeStorage, platform = process.platform }) {
  function keyringAvailable() {
    try {
      return safeStorage.isEncryptionAvailable() &&
        (platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
    } catch { return false; }
  }
  function privateDirectory() {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (platform !== "win32") fs.chmodSync(path.dirname(file), 0o700);
  }
  function read() {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile()) throw Error("Device pairing storage must be a regular file.");
      privateDirectory();
      if (platform !== "win32") fs.chmodSync(file, 0o600);
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      if (value?.version === 2 && Array.isArray(value.pairings)) return value.pairings;
      if (value && typeof value.server === "string" && value.version === undefined) return [value];
      throw Error("Unrecognized device pairing storage.");
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }
  function write(pairings) {
    privateDirectory();
    const temporary = file + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 2, pairings }), { encoding: "utf8", mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  function encode(next) {
    const { credential, ...saved } = validatePairing(next);
    if (keyringAvailable()) saved.encryptedCredential = safeStorage.encryptString(credential).toString("base64");
    else if (platform === "linux") saved.credential = credential;
    else throw new Error("OS credential storage is unavailable.");
    return saved;
  }
  function originOf(saved) {
    try { return pairingOrigin(saved?.server); } catch { return undefined; }
  }
  function load() {
    const records = read();
    const counts = new Map();
    for (const value of records) {
      const origin = originOf(value);
      if (origin) counts.set(origin, (counts.get(origin) || 0) + 1);
    }
    const entries = new Map();
    let upgraded = false;
    const next = records.map(saved => {
      const origin = originOf(saved);
      if (!origin) return saved;
      try {
        if (counts.get(origin) !== 1) throw Error("Duplicate saved pairings. Re-pair this server.");
        let credential;
        if (saved.encryptedCredential) {
          if (!safeStorage.isEncryptionAvailable()) throw Error("OS credential storage is unavailable.");
          credential = safeStorage.decryptString(Buffer.from(saved.encryptedCredential, "base64"));
        } else if (platform === "linux") credential = saved.credential;
        const config = validatePairing({ ...saved, credential });
        entries.set(origin, { config });
        if (!saved.encryptedCredential && keyringAvailable()) {
          const encrypted = encode(config);
          upgraded = true;
          return encrypted;
        }
      } catch {
        entries.set(origin, { error: "Could not unlock or validate this saved pairing. Re-pair this server." });
      }
      return saved;
    });
    if (upgraded) {
      try { write(next); } catch { /* Keep the existing pairing usable if an optional upgrade fails. */ }
    }
    return entries;
  }
  function save(next) {
    const saved = encode(next);
    const records = read();
    const index = records.findIndex(value => originOf(value) === saved.server);
    const others = records.filter(value => originOf(value) !== saved.server);
    others.splice(index < 0 ? others.length : index, 0, saved);
    write(others);
  }
  function remove(origin) {
    const records = read();
    write(records.filter(value => originOf(value) !== origin));
  }
  return { load, save, remove };
}
module.exports = { createCredentialStore };
