/**
 * Disposable PostgreSQL helpers for tests. Only databases named rf_test_* can be
 * created or dropped; the admin URL must point at a disposable local/CI server.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { PrismaClient } from '@prisma/client';

export const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rf_local:rf_local_dev_only@127.0.0.1:55432/postgres';

const NAME_RE = /^rf_test_[a-z0-9_]{1,50}$/;

export function assertDisposableName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`Refusing to touch non-test database name: ${name}`);
}

export function databaseUrl(name: string): string {
  assertDisposableName(name);
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

export function randomDbName(prefix = 'rf_test'): string {
  return `${prefix}_${randomBytes(5).toString('hex')}`;
}

async function withAdmin<T>(fn: (admin: PrismaClient) => Promise<T>): Promise<T> {
  const admin = new PrismaClient({ datasourceUrl: ADMIN_URL });
  try {
    return await fn(admin);
  } finally {
    await admin.$disconnect();
  }
}

export async function createDatabase(name: string, template?: string): Promise<void> {
  assertDisposableName(name);
  if (template) assertDisposableName(template);
  await withAdmin(async (admin) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"${template ? ` TEMPLATE "${template}"` : ''}`);
        return;
      } catch (e) {
        // 55006: template in use by a concurrent clone; retry briefly.
        const msg = String((e as { message?: string }).message ?? '');
        if (template && /being accessed by other users|55006/.test(msg) && attempt < 39) {
          await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
          continue;
        }
        throw e;
      }
    }
  });
}

export async function dropDatabase(name: string): Promise<void> {
  assertDisposableName(name);
  await withAdmin(async (admin) => {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
}

export function migrate(name: string): void {
  const prismaCli = path.resolve('node_modules/prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl(name) },
    stdio: 'pipe',
  });
}

/** Applies only the first `count` committed migrations (to build a synthetic older schema). */
export function migratePartial(name: string, count: number): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'rf-mig-'));
  try {
    cpSync(path.resolve('prisma/schema.prisma'), path.join(dir, 'schema.prisma'));
    mkdirSync(path.join(dir, 'migrations'));
    cpSync(path.resolve('prisma/migrations/migration_lock.toml'), path.join(dir, 'migrations/migration_lock.toml'));
    const all = readdirSync(path.resolve('prisma/migrations')).filter((d) => /^\d+_/.test(d)).sort();
    for (const m of all.slice(0, count)) cpSync(path.resolve('prisma/migrations', m), path.join(dir, 'migrations', m), { recursive: true });
    const prismaCli = path.resolve('node_modules/prisma/build/index.js');
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', path.join(dir, 'schema.prisma')], {
      env: { ...process.env, DATABASE_URL: databaseUrl(name) },
      stdio: 'pipe',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function migrationNames(): string[] {
  return readdirSync(path.resolve('prisma/migrations')).filter((d) => /^\d+_/.test(d)).sort();
}
