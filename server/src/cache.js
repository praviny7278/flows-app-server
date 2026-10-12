import Redis from "ioredis";
import { createLogger } from "./logger.js";

const logger = createLogger("redis");
const SESSION_TTL_SECONDS = 300;
const MEMBERSHIP_TTL_SECONDS = 60;
const USER_SESSION_SET_TTL_SECONDS = 31 * 24 * 60 * 60;
const ERROR_LOG_INTERVAL_MS = 30_000;

let lastErrorLogAt = 0;

function logThrottled(error) {
	const now = Date.now();
	if (now - lastErrorLogAt < ERROR_LOG_INTERVAL_MS) return;
	lastErrorLogAt = now;
	logger.warn("Redis cache error (further errors suppressed for 30s):", error?.message ?? error);
}

function createRedisClient() {
	const url = process.env.REDIS_URL;
	if (!url) return null;
	const client = new Redis(url, {
		maxRetriesPerRequest: 2,
		enableReadyCheck: true,
	});
	client.on("error", logThrottled);
	client.on("ready", () => logger.info("Redis connection ready."));
	client.on("close", () => logger.warn("Redis connection closed."));
	return client;
}

export const redis = createRedisClient();
export const cacheEnabled = redis !== null;

async function safe(operation, fallback = null) {
	if (!redis) return fallback;
	try {
		return await operation();
	} catch (error) {
		logThrottled(error);
		return fallback;
	}
}

function parseJson(raw) {
	if (!raw) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export async function getCachedSession(tokenHash) {
	const raw = await safe(() => redis.get(`sess:${tokenHash}`));
	const cached = parseJson(raw);
	if (!cached) return null;
	if (cached.expiresAt <= Date.now()) {
		await safe(() => redis.del(`sess:${tokenHash}`));
		return null;
	}
	return cached;
}

export async function setCachedSession(tokenHash, userId, { user, organizations }, expiresAt) {
	await safe(async () => {
		const ttl = Math.max(
			1,
			Math.min(SESSION_TTL_SECONDS, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)),
		);
		const key = `sess:${tokenHash}`;
		const userKey = `usess:${userId}`;
		await redis
			.multi()
			.set(key, JSON.stringify({ user, organizations, expiresAt: expiresAt.getTime() }), "EX", ttl)
			.sadd(userKey, tokenHash)
			.expire(userKey, USER_SESSION_SET_TTL_SECONDS)
			.exec();
	});
}

export async function invalidateSession(tokenHash) {
	if (!tokenHash) return;
	await safe(() => redis.del(`sess:${tokenHash}`));
}

export async function registerSessionToken(userId, tokenHash) {
	await safe(async () => {
		const userKey = `usess:${userId}`;
		await redis
			.multi()
			.sadd(userKey, tokenHash)
			.expire(userKey, USER_SESSION_SET_TTL_SECONDS)
			.exec();
	});
}

export async function invalidateUserSessions(userId) {
	await safe(async () => {
		const tokenHashes = await redis.smembers(`usess:${userId}`);
		const pipeline = redis.pipeline();
		for (const tokenHash of tokenHashes) pipeline.del(`sess:${tokenHash}`);
		pipeline.del(`usess:${userId}`);
		await pipeline.exec();
	});
}

export async function getCachedMembership(userId, organizationKey) {
	const raw = await safe(() => redis.get(`mem:${userId}:${organizationKey}`));
	return parseJson(raw);
}

export async function setCachedMembership(userId, organizationKey, membership) {
	await safe(() =>
		redis.set(
			`mem:${userId}:${organizationKey}`,
			JSON.stringify(membership),
			"EX",
			MEMBERSHIP_TTL_SECONDS,
		),
	);
}

export async function invalidateMembership(userId, organizationId) {
	if (!userId) return;
	await safe(async () => {
		const pipeline = redis.pipeline();
		pipeline.del(`mem:${userId}:${organizationId}`);
		pipeline.del(`mem:${userId}:first`);
		await pipeline.exec();
	});
}
