export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = {
  level: LogLevel;
  debug: (message: string, meta?: unknown) => void;
  info: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
  error: (message: string, meta?: unknown) => void;
};

export type LoggerOptions = {
  level?: LogLevel;
};

function createNoopLogger(level: LogLevel): Logger {
  const log = (value: unknown) => {
    return value;
  };

  return {
    level,
    debug: () => {
      log(null);
    },
    info: () => {
      log(null);
    },
    warn: () => {
      log(null);
    },
    error: () => {
      log(null);
    }
  };
}

export function createLogger(options?: LoggerOptions): Logger {
  const level = options?.level ?? "info";

  return createNoopLogger(level);
}

