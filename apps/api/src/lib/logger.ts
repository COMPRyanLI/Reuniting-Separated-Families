/**
 * Metadata-only structured logger. Callers pass explicit fields; there is no
 * helper that serializes request bodies, cookies, headers or error objects.
 */
type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
}

export function createLogger(sink: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  const emit = (level: Level, event: string, fields: Fields = {}) => {
    sink(JSON.stringify({ t: new Date().toISOString(), level, event, ...fields }));
  };
  return {
    info: (e, f) => emit('info', e, f),
    warn: (e, f) => emit('warn', e, f),
    error: (e, f) => emit('error', e, f),
  };
}

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
