import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config.js';
import type { Clock } from './lib/clock.js';
import type { AppCrypto } from './lib/crypto.js';
import type { Logger } from './lib/logger.js';

/** Optional fault-injection hooks used only by tests (e.g. worker crash simulation). */
export interface TestHooks {
  afterNotificationInsert?: (jobId: string) => Promise<void> | void;
  beforeApprovalCommit?: () => Promise<void> | void;
  /** Runs between the matching-task authority check and the proposal transaction. */
  afterMatchingTaskCheck?: () => Promise<void> | void;
}

export interface Deps {
  config: AppConfig;
  prisma: PrismaClient;
  clock: Clock;
  crypto: AppCrypto;
  logger: Logger;
  hooks?: TestHooks;
}
