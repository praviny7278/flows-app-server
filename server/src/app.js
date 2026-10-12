import cors from "cors";
import compression from "compression";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { createApiRouter } from "./api.js";
import { createLogger, createRequestLogger } from "./logger.js";
import { createPasswordRecoveryRouters } from "./password-recovery.js";
import {
	getCachedSession,
	invalidateSession,
	redis,
	registerSessionToken,
	setCachedSession,
} from "./cache.js";
import { createPageViewQueue } from "./pageview-queue.js";

const prisma = new PrismaClient();
const appLogger = createLogger("api");
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const rememberSessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const organizationRoleLabels = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  MEMBER: "Member",
  VIEWER: "Viewer",
};
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  rememberMe: z.boolean().default(false),
});
const pageViewSchema = z.object({
  path: z.string().min(1).max(256)
    .refine((path) => path.startsWith("/") && !path.startsWith("//") && !path.includes("?") && !path.includes("#")),
});

function getSessionId(request) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;

  const sessionCookie = cookieHeader.split(";").map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith("flowops_session="));
  return sessionCookie?.slice("flowops_session=".length);
}

function hashSessionId(sessionId) {
  return createHash("sha256").update(sessionId).digest("hex");
}

function setSessionCookie(response, sessionId, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = maxAgeSeconds ? `; Max-Age=${maxAgeSeconds}` : "";
  response.setHeader("Set-Cookie", `flowops_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/${maxAge}${secure}`);
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `flowops_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function sendUnauthenticated(response) {
  response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to access this resource." } });
}

async function requireDemoSession(request, response, next) {
  const sessionId = getSessionId(request);
  if (!sessionId) {
    sendUnauthenticated(response);
    return;
  }
  const tokenHash = hashSessionId(sessionId);

  const cached = await getCachedSession(tokenHash);
  if (cached) {
    response.locals.user = cached.user;
    response.locals.organizations = cached.organizations;
    response.locals.sessionTokenHash = tokenHash;
    response.locals.sessionUserId = cached.user.id;
    next();
    return;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          timezone: true,
          preferences: true,
          memberships: {
            select: {
              role: true,
              customRole: { select: { name: true } },
              organization: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!session) {
    sendUnauthenticated(response);
    return;
  }
  if (session.expiresAt <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } });
    await invalidateSession(tokenHash);
    clearSessionCookie(response);
    sendUnauthenticated(response);
    return;
  }

  const organizations = session.user.memberships.map(({ role, customRole, organization }) => ({
    ...organization,
    role: customRole?.name ?? organizationRoleLabels[role],
  }));
  const user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    timezone: session.user.timezone,
    preferences: session.user.preferences,
    organization: organizations[0] ?? null,
  };
  response.locals.user = user;
  response.locals.organizations = organizations;
  response.locals.sessionTokenHash = tokenHash;
  response.locals.sessionUserId = user.id;
  await setCachedSession(tokenHash, user.id, { user, organizations }, session.expiresAt);
  next();
}

function sendValidationError(response, details) {
  response.status(400).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "The request contains invalid data.",
      details,
    },
  });
}

let rateLimitErrorLoggedAt = 0;

const loopDelay = monitorEventLoopDelay({ resolution: 10 });
loopDelay.enable();

const runtimeMetrics = {
  startedAt: Date.now(),
  requests: 0,
  rateLimited: 0,
  byStatus: { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
};

function nanosToMs(value) {
  return Math.round((Number.isFinite(value) ? value : 0) / 1e5) / 10;
}

function logRateLimitError(error) {
  const now = Date.now();
  if (now - rateLimitErrorLoggedAt < 30_000) return;
  rateLimitErrorLoggedAt = now;
  appLogger.warn(
    "Rate limiter Redis error (failing open, further errors suppressed for 30s):",
    error?.message ?? error,
  );
}

function rateLimitStore(prefix) {
  if (!redis) return undefined;
  return new RedisStore({
    prefix,
    sendCommand: async (command, ...args) => {
      try {
        return await redis.call(command, ...args);
      } catch (error) {
        logRateLimitError(error);
        const normalized = String(command).toUpperCase();
        if (normalized === "SCRIPT") return "";
        if (normalized === "EVALSHA") return [1, Date.now() + 60_000];
        if (normalized === "DECR") return 0;
        if (normalized === "DEL") return 1;
        return null;
      }
    },
  });
}

function sendRateLimited(_request, response) {
  runtimeMetrics.rateLimited += 1;
  response.status(429).json({
    error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
  });
}




export function createApp() {
  const app = express();
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(compression());
  app.use(cors({ origin: webOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(createRequestLogger({ name: "http" }));
  app.use("/api/v1", (_request, response, next) => {
    response.setHeader("Cache-Control", "private, no-cache");
    next();
  });
  app.use((_request, response, next) => {
    runtimeMetrics.requests += 1;
    response.on("finish", () => {
      const bucket = `${Math.floor(response.statusCode / 100)}xx`;
      if (Object.hasOwn(runtimeMetrics.byStatus, bucket)) runtimeMetrics.byStatus[bucket] += 1;
    });
    next();
  });

  const pageViewQueue = redis ? createPageViewQueue({ redis, prisma }) : null;
  if (pageViewQueue) {
    pageViewQueue.start().catch((error) => {
      appLogger.error("Page-view queue failed to start:", error?.message ?? error);
    });
  }

  const globalLimiter = rateLimit({
    windowMs: 60_000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    store: rateLimitStore("rl:global:"),
    passOnStoreError: true,
    handler: sendRateLimited,
  });

  const loginLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: rateLimitStore("rl:login:"),
    keyGenerator: (request) =>
      `login:${ipKeyGenerator(request.ip ?? "")}:${String(request.body?.email ?? "").toLowerCase()}`,
    passOnStoreError: true,
    handler: sendRateLimited,
  });

  const pageViewLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    store: rateLimitStore("rl:pageview:"),
    keyGenerator: (request) => {
      const sessionId = getSessionId(request);
      return `pageview:${ipKeyGenerator(request.ip ?? "")}:${sessionId ? hashSessionId(sessionId) : "anonymous"}`;
    },
    passOnStoreError: true,
    handler: sendRateLimited,
  });

  const recoveryLimiter = rateLimit({
    windowMs: 60_000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: rateLimitStore("rl:recovery:"),
    keyGenerator: (request) => `recovery:${ipKeyGenerator(request.ip ?? "")}`,
    passOnStoreError: true,
    handler: sendRateLimited,
  });

  const userLimiter = rateLimit({
    windowMs: 60_000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    store: rateLimitStore("rl:user:"),
    keyGenerator: (request, response) =>
      `user:${response.locals?.sessionUserId ?? ipKeyGenerator(request.ip ?? "")}`,
    passOnStoreError: true,
    handler: sendRateLimited,
  });

  app.use("/api/v1", globalLimiter);

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "flowops-api", mode: "demo" });
  });

  app.get("/metrics", async (_request, response) => {
    const memory = process.memoryUsage();
    const snapshot = {
      mean: loopDelay.mean,
      p95: loopDelay.percentile(95),
      max: loopDelay.max,
    };
    loopDelay.reset();
    let database = "unavailable";
    try {
      await prisma.$runCommandRaw({ ping: 1 });
      database = "connected";
    } catch {
      database = "unavailable";
    }
    response.json({
      service: "flowops-api",
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: new Date(runtimeMetrics.startedAt).toISOString(),
      requests: {
        total: runtimeMetrics.requests,
        rateLimited: runtimeMetrics.rateLimited,
        byStatus: runtimeMetrics.byStatus,
      },
      eventLoopDelayMs: {
        mean: nanosToMs(snapshot.mean),
        p95: nanosToMs(snapshot.p95),
        max: nanosToMs(snapshot.max),
      },
      memory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
      },
      database,
      redis: redis ? "configured" : "disabled",
      pageViewQueue: pageViewQueue ? "running" : "disabled",
    });
  });

  app.get("/health/db", async (_request, response) => {
    try {
      await prisma.$runCommandRaw({ ping: 1 });
      response.json({ status: "ok", database: "connected" });
    } catch {
      response.status(503).json({ status: "error", database: "unavailable" });
    }
  });

  app.post("/api/v1/traffic/page-view", pageViewLimiter, async (request, response) => {
    const parsed = pageViewSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, parsed.error.issues);

    let userId;
    let organizationId;
    const sessionId = getSessionId(request);
    if (sessionId) {
      const tokenHash = hashSessionId(sessionId);
      let context = await getCachedSession(tokenHash);
      if (!context) {
        const session = await prisma.session.findUnique({
          where: { tokenHash },
          include: { user: { select: { id: true, memberships: { select: { organizationId: true } } } } },
        });
        if (session && session.expiresAt > new Date()) {
          context = {
            user: { id: session.user.id },
            organizations: session.user.memberships.map((membership) => ({ id: membership.organizationId })),
          };
        }
      }
      if (context) {
        userId = context.user.id;
        const requestedOrganizationId = request.get("x-organization-id");
        organizationId = context.organizations.find((organization) =>
          organization.id === requestedOrganizationId)?.id
          ?? context.organizations[0]?.id;
      }
    }

    if (pageViewQueue) {
      try {
        await pageViewQueue.enqueue({
          path: parsed.data.path,
          userId,
          organizationId,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        appLogger.error("Unable to enqueue page view:", error?.message ?? error);
        response.status(503).json({
          error: { code: "SERVICE_UNAVAILABLE", message: "The page view could not be recorded. Please retry." },
        });
        return;
      }
      response.status(202).json({ recorded: true });
      return;
    }

    await prisma.monitoringEvent.create({
      data: {
        type: "PAGE_VIEW",
        path: parsed.data.path,
        ...(userId ? { userId } : {}),
        ...(organizationId ? { organizationId } : {}),
      },
    });
    response.status(202).json({ recorded: true });
  });

  app.post("/api/v1/auth/login", loginLimiter, async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, parsed.error.issues);

    const { email, password, rememberMe } = parsed.data;
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        memberships: {
          select: {
            role: true,
            customRole: { select: { name: true } },
            organization: { select: { id: true, name: true } },
          },
        },
      },
    });
    const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !passwordMatches) {
      response.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "The email or password is incorrect." } });
      return;
    }

    const sessionId = randomBytes(32).toString("hex");
    const lifetimeMs = rememberMe ? rememberSessionLifetimeMs : sessionLifetimeMs;
    const tokenHash = hashSessionId(sessionId);
    await prisma.$transaction(async (transaction) => {
      await transaction.session.create({
        data: {
          tokenHash,
          userId: user.id,
          expiresAt: new Date(Date.now() + lifetimeMs),
        },
      });
      await transaction.monitoringEvent.createMany({
        data: user.memberships.length
          ? user.memberships.map(({ role, customRole, organization }) => ({
            type: "LOGIN",
            userId: user.id,
            organizationId: organization.id,
            role: customRole?.name ?? organizationRoleLabels[role],
          }))
          : [{ type: "LOGIN", userId: user.id }],
      });
    });
    await registerSessionToken(user.id, tokenHash);
    setSessionCookie(response, sessionId, rememberMe ? Math.floor(lifetimeMs / 1000) : undefined);
    const organizations = user.memberships.map(({ role, customRole, organization }) => ({
      ...organization,
      role: customRole?.name ?? organizationRoleLabels[role],
    }));
    response.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        organization: organizations[0] ?? null,
      },
    });
  });

  app.post("/api/v1/auth/logout", async (request, response) => {
    const sessionId = getSessionId(request);
    if (sessionId) {
      const tokenHash = hashSessionId(sessionId);
      await prisma.session.deleteMany({ where: { tokenHash } });
      await invalidateSession(tokenHash);
    }
    clearSessionCookie(response);
    response.status(204).end();
  });

  app.get("/api/v1/auth/me", requireDemoSession, (_request, response) => {
    response.json({ user: response.locals.user });
  });

  app.get("/api/v1/organizations", requireDemoSession, (_request, response) => {
    response.json({ data: response.locals.organizations });
  });


  
  const recoveryRouters = createPasswordRecoveryRouters(prisma, { publicLimiter: recoveryLimiter });
  app.use("/api/v1/auth/password", recoveryRouters.publicRouter);
  app.use("/api/v1/auth/password", requireDemoSession, recoveryRouters.authenticatedRouter);
  app.use("/api/v1", requireDemoSession, userLimiter, createApiRouter(prisma));

  app.use((_request, response) => {
    response.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found." } });
  });

  app.use((error, request, response, _next) => {
    appLogger.error(
      `Unhandled API error on ${request.method} ${request.originalUrl ?? request.url}`,
      error,
    );
    response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } });
  });

  app.locals.prisma = prisma;
  app.locals.redis = redis;
  app.locals.pageViewQueue = pageViewQueue;

  return app;
}
