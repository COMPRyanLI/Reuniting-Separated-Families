import { describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(__dirname, '../..');
const script = path.join(root, 'scripts/docs-check.mjs');

function copyDocs(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'rf-docs-'));
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'agent.md', 'README.md', 'design.md']) cpSync(path.join(root, f), path.join(dir, f));
  cpSync(path.join(root, 'docs'), path.join(dir, 'docs'), { recursive: true });
  return dir;
}

function run(cwd: string) {
  return spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
}

describe('FND-04 docs:check detects drift', () => {
  it('passes on the real documentation', () => {
    const r = run(root);
    expect(r.status, r.stderr).toBe(0);
  });

  it('fails when instruction copies differ', () => {
    const dir = copyDocs();
    try {
      appendFileSync(path.join(dir, 'agent.md'), '\nextra line\n');
      const r = run(dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('instruction files differ');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails on a broken local link and an undefined phase test ID', () => {
    const dir = copyDocs();
    try {
      appendFileSync(path.join(dir, 'design.md'), '\nSee [missing](docs/nope.md).\n');
      writeFileSync(path.join(dir, 'docs/implementation/99-extra.md'), 'Gate: ZZZ-01\n');
      const r = run(dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('broken link docs/nope.md');
      expect(r.stderr).toContain('undefined test ID ZZZ-01');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
