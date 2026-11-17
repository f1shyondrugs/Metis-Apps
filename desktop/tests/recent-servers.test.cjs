const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRecentServers, serverArgument, buildJumpList } = require('../src/main/recent-servers.cjs');
function fixture(t, saved) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metis-history-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'server.json');
  if (saved !== undefined) fs.writeFileSync(configPath, typeof saved === 'string' ? saved : JSON.stringify(saved));
  return { directory, configPath, history: createRecentServers({ configPath }) };
}
test('fresh profile has no fabricated history and legacy URL migrates without writing', t => {
  const fresh = fixture(t);
  assert.deepEqual(fresh.history.list(), []);
  assert.equal(fs.existsSync(fresh.configPath), false);
  const legacy = fixture(t, { url: 'https://EXAMPLE.com:443/' });
  assert.equal(legacy.history.getCurrent(), 'https://example.com/');
  assert.equal(legacy.history.list()[0].label, 'example.com');
  assert.equal(JSON.parse(fs.readFileSync(legacy.configPath)).recentServers, undefined);
});
test('initial paired server seeds history but saved browser selection remains authoritative', t => {
  const { configPath } = fixture(t, { url: 'https://saved.example/' });
  const history = createRecentServers({ configPath, initialServer: 'https://paired.example/' });
  assert.equal(history.getCurrent(), 'https://saved.example/');
  assert.deepEqual(history.list().map(e => e.url), ['https://saved.example/']);
  const initial = createRecentServers({ configPath: configPath + '.missing', initialServer: 'https://paired.example/' });
  assert.equal(initial.list()[0].url, 'https://paired.example/');
});
test('selection persists MRU, canonical duplicates, stable opaque IDs and ten-entry bound', t => {
  const { configPath, history } = fixture(t);
  for (let i = 0; i < 12; i++) history.select('https://server' + i + '.example/');
  assert.equal(history.list().length, 10);
  const original = history.list().find(e => e.url === 'https://server4.example/');
  history.select('https://SERVER4.example:443/');
  assert.equal(history.list()[0].id, original.id);
  assert.equal(history.resolve(original.id), original.url);
  assert.deepEqual(createRecentServers({ configPath }).list(), history.list());
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath)).recentServers, history.list().map(e => e.url));
  const copy = history.list(); copy[0].url = 'https://tampered.example/';
  assert.equal(history.resolve(original.id), original.url);
});
test('corrupt history and unsafe addresses are ignored independently of valid current URL', t => {
  const { history } = fixture(t, {
    url: 'https://safe.example/',
    recentServers: ['file:///secret', 'https://user:pass@example.com/', 'https://safe.example/', null, 'https://other.example/']
  });
  assert.deepEqual(history.list().map(e => e.url), ['https://safe.example/', 'https://other.example/']);
  for (const value of ['http://public.example/', 'javascript:alert(1)', 'https://safe.example/?token=private', 'https://safe.example/#secret']) {
    assert.throws(() => history.select(value));
  }
  assert.equal(history.getCurrent(), 'https://safe.example/');
  assert.deepEqual(fixture(t, '{bad json').history.list(), []);
});
test('failed atomic write preserves previous file, in-memory selection, and cleans temporary file', t => {
  const { configPath, directory, history } = fixture(t, { url: 'https://before.example/' });
  const original = fs.readFileSync(configPath);
  const rename = fs.renameSync;
  fs.renameSync = () => { throw Error('fixture rename denied'); };
  try { assert.throws(() => history.select('https://after.example/'), /rename denied/); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(configPath), original);
  assert.equal(history.getCurrent(), 'https://before.example/');
  assert.deepEqual(fs.readdirSync(directory), ['server.json']);
});
test('labels retain domain or IPv6 address and port without credentials', t => {
  const { history } = fixture(t);
  history.select('https://[2001:db8::1]:8443/');
  assert.equal(history.list()[0].label, '[2001:db8::1]:8443');
  history.select('http://localhost:3123/');
  assert.equal(history.list()[0].label, 'localhost:3123');
  history.select('https://same.example/alternate');
  history.select('https://same.example/');
  assert.deepEqual(history.list().slice(0, 2).map(e => e.label), ['same.example', 'same.example/alternate']);
  const tasks = buildJumpList({ entries: history.list(), execPath: 'Metis.exe', packaged: true });
  assert.deepEqual(tasks[1].items.slice(0, 2).map(e => e.title), ['same.example', 'same.example/alternate']);
});
test('launcher accepts exactly one strictly bounded opaque ID and cannot navigate arbitrary URLs', t => {
  const { history } = fixture(t, { url: 'https://known.example/' });
  const id = history.list()[0].id;
  assert.equal(serverArgument(['app.exe', '--metis-server=' + id]), id);
  for (const args of [null, [], ['--metis-server=https://evil.example/'], ['--metis-server=' + id, '--metis-server=' + id], ['--metis-server', id], ['--metis-server=' + id.toUpperCase()], ['--metis-server=' + id + 'x']]) {
    assert.equal(serverArgument(args), null);
  }
  assert.equal(history.resolve('0'.repeat(24)), null);
  assert.equal(history.resolve('https://evil.example/'), null);
  assert.equal(history.resolve(null), null);
});
test('Windows Jump List launches remembered IDs, handles quoted development paths and removed items', t => {
  const { history } = fixture(t, { url: 'https://one.example/' });
  history.select('https://two.example:8443/');
  const options = { entries: history.list(), execPath: 'C:\\Program Files\\Metis\\Metis.exe', appPath: 'C:\\Dev Projects\\Metis\\', packaged: true };
  const categories = buildJumpList(options);
  assert.equal(categories[0].type,'tasks');
  assert.equal(categories[0].items[0].title,'New Window');
  assert.equal(categories[0].items[0].args,'--metis-new-window');
  assert.equal(categories[1].name, 'Recent Servers');
  assert.equal(categories[1].items.length, 2);
  const item = categories[1].items[0];
  assert.equal(item.title, 'two.example:8443');
  assert.equal(item.program, options.execPath);
  assert.equal(item.args, '--metis-server=' + history.list()[0].id);
  assert.equal(item.args.includes('https:'), false);
  assert.equal(buildJumpList({ ...options, removedItems: [item] })[1].items.length, 1);
  assert.equal(buildJumpList({ ...options, removedItems: categories[1].items }).length, 1);
  const dev = buildJumpList({ ...options, packaged: false })[1].items[0];
  assert.equal(dev.args, '"C:\\Dev Projects\\Metis\\\\" --metis-server=' + history.list()[0].id);
  assert.equal(buildJumpList({ ...options, entries: [{ ...history.list()[0], id: 'bad' }] }).length, 1);
});
