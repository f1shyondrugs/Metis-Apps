const { spawnSync } = require('node:child_process');
const files = ['main.cjs', 'preload.cjs', 'policy.cjs', 'ui/renderer.js', 'tests/smoke.cjs', 'tests/policy.test.cjs'];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('CHECK_OK');
