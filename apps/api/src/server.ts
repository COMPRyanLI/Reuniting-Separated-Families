import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { createPrisma } from './db.js';
import { systemClock } from './lib/clock.js';
import { createCrypto } from './lib/crypto.js';
import { createLogger } from './lib/logger.js';
import { runWorkerLoop } from './jobs/loop.js';
import { runRetention } from './jobs/retention.js';

const logger = createLogger();

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      logger.error('startup_config_invalid', { variables: e.variables.join(',') });
      process.exit(1);
    }
    throw e;
  }
  const prisma = createPrisma(config.databaseUrl);
  const crypto = createCrypto(config);
  const deps = { config, prisma, clock: systemClock, crypto, logger };
  const app = createApp(deps);
  const server = app.listen(config.port, () => {
    logger.info('server_listening', { port: config.port, demoMode: config.demoMode, env: config.nodeEnv, workerInProcess: config.runWorkerInProcess });
  });

  // Single-process hosting: run the same outbox/retention loop the separate worker would run.
  const workerAbort = new AbortController();
  let worker: Promise<void> | null = null;
  if (config.runWorkerInProcess) {
    let lastRetention = 0;
    worker = runWorkerLoop(deps, workerAbort.signal, async () => {
      if (Date.now() - lastRetention < config.retentionIntervalMs) return;
      lastRetention = Date.now();
      await runRetention(deps);
    });
  }

  const shutdown = (signal: string) => {
    logger.info('server_shutdown', { signal });
    workerAbort.abort();
    server.close(() => {
      void (worker ?? Promise.resolve()).finally(() => void prisma.$disconnect().finally(() => process.exit(0)));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main().catch(() => {
  logger.error('startup_failed', {});
  process.exit(1);
});
