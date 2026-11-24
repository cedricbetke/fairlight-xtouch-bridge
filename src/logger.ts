export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogFields = Record<string, unknown>;
export type LogSink = (line: string) => void;

export interface Logger {
  readonly level: LogLevel;
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

function serialiseError(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function normaliseValue(value: unknown, seen: Set<object>): unknown {
  if (value instanceof Error) return serialiseError(value);
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => normaliseValue(entry, seen));
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = normaliseValue(entry, seen);
  }
  return result;
}

function formatPretty(level: LogLevel, event: string, fields: LogFields): string {
  const parts = Object.entries(fields).map(([key, value]) => {
    if (value instanceof Error) return `${key}=${JSON.stringify(value.message)}`;
    if (typeof value === "string") return `${key}=${JSON.stringify(value)}`;
    if (value === undefined) return `${key}=undefined`;
    return `${key}=${JSON.stringify(normaliseValue(value, new Set()))}`;
  });
  return `${new Date().toISOString()} ${level.toUpperCase()} ${event}${
    parts.length > 0 ? " " + parts.join(" ") : ""
  }`;
}

export function createLogger(
  level: LogLevel,
  options: { pretty?: boolean; sink?: LogSink; baseFields?: LogFields } = {},
): Logger {
  const sink = options.sink ?? ((line) => process.stderr.write(line + "\n"));
  const pretty = options.pretty ?? false;
  const baseFields = options.baseFields ?? {};

  const write = (entryLevel: LogLevel, event: string, fields: LogFields): void => {
    if (LEVEL_ORDER[entryLevel] < LEVEL_ORDER[level]) return;
    const merged: LogFields = { ...baseFields, ...fields };
    const normalised = normaliseValue(merged, new Set()) as Record<string, unknown>;
    if (pretty) {
      sink(formatPretty(entryLevel, event, normalised));
      return;
    }
    const entry = {
      time: new Date().toISOString(),
      level: entryLevel,
      event,
      ...normalised,
    };
    sink(JSON.stringify(entry));
  };

  const logger: Logger = {
    level,
    debug: (event, fields) => write("debug", event, fields ?? {}),
    info: (event, fields) => write("info", event, fields ?? {}),
    warn: (event, fields) => write("warn", event, fields ?? {}),
    error: (event, fields) => write("error", event, fields ?? {}),
    child: (fields) => createLogger(level, { pretty, sink, baseFields: { ...baseFields, ...fields } }),
  };
  return logger;
}

export function isLogLevel(value: string): value is LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}
