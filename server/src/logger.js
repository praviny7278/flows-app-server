import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { inspect } from "node:util";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const COLORS = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  gray: "\u001b[90m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  white: "\u001b[37m",
};

const LEVEL_COLORS = {
  debug: COLORS.gray,
  info: COLORS.cyan,
  warn: COLORS.yellow,
  error: COLORS.red,
};

const LEVEL_TAGS = {
  debug: "DEBUG",
  info: " INFO",
  warn: " WARN",
  error: "ERROR",
};

function resolveLevel() {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (raw in LEVELS) return raw;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const threshold = LEVELS[resolveLevel()] ?? LEVELS.info;
const colorEnabled =
  !process.env.NO_COLOR &&
  process.env.FORCE_COLOR !== "0" &&
  (process.env.FORCE_COLOR !== undefined || Boolean(process.stdout.isTTY));

const fileLoggingEnabled = process.env.LOG_TO_FILE === "true";
const logDir = process.env.LOG_DIR ?? "logs";

function paint(color, value) {
  return colorEnabled ? `${color}${value}${COLORS.reset}` : value;
}

function timestamp() {
  const now = new Date();
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

function shortDate() {
  return new Date().toISOString().slice(0, 10);
}

function serialize(value) {
  if (value === undefined) return "";
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return inspect(value, { depth: 4, breakLength: 120, colors: false, compact: true });
  } catch {
    return String(value);
  }
}

function stringifyMeta(meta) {
  if (meta === undefined) return "";
  const serialized = serialize(meta);
  if (!serialized) return "";
  return serialized.includes("\n") ? `\n${serialized}` : ` ${serialized}`;
}

function filePath() {
  return join(logDir, `flowops-server-${shortDate()}.log`);
}

let fileSinkReady = false;

function writeToFile(line) {
  try {
    if (!fileSinkReady) {
      mkdirSync(dirname(filePath()), { recursive: true });
      fileSinkReady = true;
    }
    appendFileSync(filePath(), `${line}\n`, "utf8");
  } catch {
    /* never let the log file break the process */
  }
}

function emit(level, scope, message, meta) {
  if (LEVELS[level] < threshold) return;

  const scopeLabel = scope ? paint(COLORS.magenta, `[${scope}]`) : "";
  const parts = [
    paint(COLORS.gray, timestamp()),
    paint(LEVEL_COLORS[level], LEVEL_TAGS[level]),
    scopeLabel,
    typeof message === "string" ? message : serialize(message),
  ].filter(Boolean);

  const rendered = `${parts.join(" ")}${stringifyMeta(meta)}`;
  const sink = level === "warn" ? console.warn : level === "error" ? console.error : console.log;
  sink(rendered);
  if (fileLoggingEnabled) writeToFile(rendered.replace(/\u001b\[[0-9;]*m/g, ""));
}

function normalizeArgs(args) {
  if (args.length === 0) return { message: "", meta: undefined };
  const [message, ...rest] = args;
  return { message, meta: rest.length === 0 ? undefined : rest.length === 1 ? rest[0] : rest };
}

export function createLogger(scope) {
  const logger = {
    scope,
    debug: (...args) => {
      const { message, meta } = normalizeArgs(args);
      emit("debug", scope, message, meta);
    },
    info: (...args) => {
      const { message, meta } = normalizeArgs(args);
      emit("info", scope, message, meta);
    },
    warn: (...args) => {
      const { message, meta } = normalizeArgs(args);
      emit("warn", scope, message, meta);
    },
    error: (...args) => {
      const { message, meta } = normalizeArgs(args);
      emit("error", scope, message, meta);
    },
    child: (childScope) => createLogger(scope ? `${scope}:${childScope}` : childScope),
  };
  return logger;
}

export const logger = createLogger("app");

export function statusColor(status) {
  if (status >= 500) return COLORS.red;
  if (status >= 400) return COLORS.yellow;
  if (status >= 300) return COLORS.cyan;
  if (status >= 200) return COLORS.green;
  return COLORS.white;
}

const DEFAULT_SKIP = [/^\/health/, /^\/metrics/, /^\/_next/, /^\/favicon/];

export function createRequestLogger({ name = "http", skip = [] } = {}) {
  const httpLogger = createLogger(name);
  const skipMatchers = [...DEFAULT_SKIP, ...skip];
  let counter = 0;

  return function requestLogger(request, response, next) {
    const path = request.originalUrl ?? request.url ?? "";
    if (process.env.HTTP_LOG === "off" || skipMatchers.some((matcher) => matcher.test(path))) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    const requestId = `${Date.now().toString(36)}-${(counter = (counter + 1) % 1_000_000).toString().padStart(6, "0")}`;
    response.locals = response.locals ?? {};
    response.locals.requestId = requestId;
    response.setHeader("x-request-id", requestId);

    httpLogger.info(
      `--> ${request.method} ${path}`,
      { requestId, ip: request.ip },
    );

    response.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const status = response.statusCode;
      const line = `${request.method} ${path} ${paint(statusColor(status), status)} ${paint(COLORS.dim, `${durationMs.toFixed(1)}ms`)}`;
      const method = status >= 500 ? httpLogger.error : status >= 400 ? httpLogger.warn : httpLogger.info;
      method.call(httpLogger, line, {
        requestId,
        status,
        durationMs: Number(durationMs.toFixed(1)),
        contentLength: response.getHeader("content-length"),
      });
    });

    next();
  };
}
