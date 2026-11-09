import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
const { createCredentialStore } = createRequire(import.meta.url)("../desktop/credential-store.cjs");
const pairing = { server: "https://metis.example", clientId: "device-1", credential: "test-only-secret", permissionMode: "user" };
function fixture(t, platform = "linux") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metis-credential-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "RemoteClient", "config.json");
  const state = { available: false, backend: "basic_text" };
  const safeStorage = {
    isEncryptionAvailable: () => state.available,
    getSelectedStorageBackend: () => state.backend,
    encryptString: value => { assert.notEqual(state.backend, "basic_text"); return Buffer.from("encrypted:" + value); },
    decryptString: value => { assert.equal(value.toString().startsWith("encrypted:"), true); return value.toString().slice(10); },
  };
  return { file, state, safeStorage, store: createCredentialStore({ file, safeStorage, platform }) };
}
for (const available of [false, true]) test("Linux persists pairing without a keyring, availability=" + available, t => {
  const f = fixture(t); f.state.available = available;
  assert.equal(f.store.load(), null);
  f.store.save(pairing);
  assert.deepEqual(createCredentialStore({ file: f.file, safeStorage: f.safeStorage, platform: "linux" }).load(), pairing);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).encryptedCredential, undefined);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(f.file)).mode & 0o777, 0o700);
  }
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)), ["config.json"]);
});
test("available Linux keyring encrypts and decrypts pairing", t => {
  const f = fixture(t); f.state.available = true; f.state.backend = "gnome_libsecret";
  f.store.save(pairing);
  const saved = JSON.parse(fs.readFileSync(f.file));
  assert.equal(saved.credential, undefined);
  assert.ok(saved.encryptedCredential);
  assert.deepEqual(f.store.load(), pairing);
});
test("Linux file pairing migrates to OS encryption after the keyring becomes available", t => {
  const f = fixture(t); f.store.save(pairing);
  f.state.available = true; f.state.backend = "kwallet6";
  assert.deepEqual(f.store.load(), pairing);
  const saved = JSON.parse(fs.readFileSync(f.file));
  assert.equal(saved.credential, undefined);
  assert.deepEqual(f.store.load(), pairing);
});
test("existing Linux basic_text encrypted pairing remains readable", t => {
  const f = fixture(t); f.state.available = true;
  fs.mkdirSync(path.dirname(f.file));
  fs.writeFileSync(f.file, JSON.stringify({ ...pairing, credential: undefined,
    encryptedCredential: Buffer.from("encrypted:" + pairing.credential).toString("base64") }));
  assert.deepEqual(f.store.load(), pairing);
});
test("existing encrypted pairing is preserved when its keyring is unavailable", t => {
  const f = fixture(t); f.state.available = true; f.state.backend = "gnome_libsecret";
  f.store.save(pairing); const before = fs.readFileSync(f.file, "utf8");
  f.state.available = false;
  assert.throws(() => f.store.load(), /original|keyring.*unavailable/);
  assert.equal(fs.readFileSync(f.file, "utf8"), before);
});
test("overwrite and load tighten existing permissive Linux storage", t => {
  const f = fixture(t); f.store.save(pairing);
  fs.chmodSync(f.file, 0o644); fs.chmodSync(path.dirname(f.file), 0o755);
  f.store.load();
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(f.file)).mode & 0o777, 0o700);
  }
  f.store.save({ ...pairing, credential: "replacement", permissionMode: "admin" });
  assert.equal(f.store.load().credential, "replacement");
  assert.equal(f.store.load().permissionMode, "admin");
});
for (const platform of ["win32", "darwin"]) {
  test(platform + " continues to require OS encryption", t => {
    const f = fixture(t, platform);
    assert.throws(() => f.store.save(pairing), /OS credential storage/);
    assert.equal(fs.existsSync(f.file), false);
    f.state.available = true; f.state.backend = "os";
    f.store.save(pairing); assert.deepEqual(f.store.load(), pairing);
  });
}
test("failed encryption preserves the previous pairing", t => {
  const f = fixture(t); f.store.save(pairing);
  const before = fs.readFileSync(f.file, "utf8");
  f.state.available = true; f.state.backend = "gnome_libsecret";
  f.safeStorage.encryptString = () => { throw Error("keyring locked during write"); };
  assert.throws(() => f.store.save({ ...pairing, credential: "replacement" }), /keyring locked/);
  assert.equal(fs.readFileSync(f.file, "utf8"), before);
});
test("missing and foreign plaintext credentials are rejected", t => {
  const f = fixture(t); fs.mkdirSync(path.dirname(f.file)); fs.writeFileSync(f.file, "{}");
  assert.throws(() => f.store.load(), /missing/);
  f.store.save(pairing);
  const mac = createCredentialStore({ file: f.file, safeStorage: f.safeStorage, platform: "darwin" });
  assert.throws(() => mac.load(), /unsupported/);
});
