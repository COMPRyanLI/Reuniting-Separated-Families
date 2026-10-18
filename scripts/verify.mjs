// Release verification: docs, lint, types, build, unit, integration, security, e2e and
// accessibility. Stops at the first failure; never reports a skipped step as passed.
// Performance and deployed smoke are separate commands (they need explicit targets).
import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('Run through npm: npm run verify');
  process.exit(1);
}
const steps = [
  ['docs:check'],
  ['lint'],
  ['typecheck'],
  ['build'],
  ['test:unit'],
  ['test:integration'],
  ['test:security'],
  ['test:e2e', '--', '--no-build'],
  ['test:a11y', '--', '--no-build'],
];
const results = [];
for (const [script, ...rest] of steps) {
  const t = Date.now();
  console.log(`\n=== npm run ${script} ${rest.join(' ')}`);
  const r = spawnSync(process.execPath, [npmCli, 'run', script, ...rest], { stdio: 'inherit' });
  const seconds = ((Date.now() - t) / 1000).toFixed(1);
  results.push(`${r.status === 0 ? 'PASS' : 'FAIL'}  ${script} (${seconds}s)`);
  if (r.status !== 0) {
    console.error(`\nverify stopped: ${script} exited with ${r.status}`);
    console.log(results.join('\n'));
    process.exit(1);
  }
}
console.log('\nverify summary:\n' + results.join('\n'));
