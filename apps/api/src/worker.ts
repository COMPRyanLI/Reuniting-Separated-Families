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
      logger.error('worker_config_invalid', { variables: e.variables.join(',') });
      process.exit(1);
    }
    throw e;
  }
  const prisma = createPrisma(config.databaseUrl);
  const crypto = createCrypto(config);
  const controller = new AbortController();
  process.on('SIGTERM', () => controller.abort());
  process.on('SIGINT', () => controller.abort());
  logger.info('worker_started', { pollMs: config.workerPollMs });
  const deps = { config, prisma, clock: systemClock, crypto, logger };
  let lastRetention = 0;
  await runWorkerLoop(deps, controller.signal, async () => {
    if (Date.now() - lastRetention < config.retentionIntervalMs) return;
    lastRetention = Date.now();
    await runRetention(deps);
  });
  await prisma.$disconnect();
  logger.info('worker_stopped', {});
}

void main().catch(() => {
  logger.error('worker_failed', {});
  process.exit(1);
});
