const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

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
  function save(next) {
    const saved = { server: next.server, clientId: next.clientId, permissionMode: next.permissionMode };
    if (keyringAvailable()) {
      saved.encryptedCredential = safeStorage.encryptString(next.credential).toString("base64");
    } else if (platform === "linux") {
      // Linux desktops may have no Secret Service. Do not pretend basic_text is encryption.
      saved.credential = next.credential;
    } else {
      throw new Error("OS credential storage is unavailable");
    }
    privateDirectory();
    const temporary = file + "." + randomUUID() + ".tmp";
    try {
      fs.writeFileSync(temporary, JSON.stringify(saved), { encoding: "utf8", mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  function load() {
    if (!fs.existsSync(file)) return null;
    privateDirectory();
    if (platform !== "win32") fs.chmodSync(file, 0o600);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    let credential;
    if (saved.encryptedCredential) {
      // Keep compatibility with existing encrypted pairings, including old basic_text records.
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("The keyring for this existing pairing is unavailable. Unlock it or pair this device again.");
      }
      credential = safeStorage.decryptString(Buffer.from(saved.encryptedCredential, "base64"));
    } else if (platform === "linux" && typeof saved.credential === "string" && saved.credential) {
      credential = saved.credential;
    } else {
      throw new Error("Stored pairing credential is missing or unsupported. Pair this device again.");
    }
    const config = { server: saved.server, clientId: saved.clientId, credential,
      permissionMode: saved.permissionMode === "user" ? "user" : "admin" };
    // Upgrade a Linux file pairing once a real OS keyring becomes available.
    if (!saved.encryptedCredential && keyringAvailable()) save(config);
    return config;
  }
  return { load, save };
}
module.exports = { createCredentialStore };
