import { randomBytes } from "node:crypto";
import { createLogger } from "./logger.js";

const logger = createLogger("pageview-queue");
const STREAM_KEY = "stream:pageviews";
const GROUP = "pageview-writers";
const CONSUMER = `writer-${process.pid}-${randomBytes(4).toString("hex")}`;
const BATCH_SIZE = 500;
const BLOCK_MS = 1000;
const CLAIM_MIN_IDLE_MS = 60_000;
const CLAIM_INTERVAL_MS = 30_000;
const MAXLEN = 1_000_000;
const MAX_BACKOFF_MS = 30_000;

function sleep(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseEntry(entry) {
	const [id, payload] = entry;
	const fields = {};
	if (Array.isArray(payload)) {
		for (let index = 0; index < payload.length; index += 2) {
			fields[payload[index]] = payload[index + 1];
		}
	} else if (payload && typeof payload === "object") {
		Object.assign(fields, payload);
	}
	return { id, fields };
}

export function createPageViewQueue({ redis, prisma }) {
	let running = false;
	let loopPromise = null;
	let retryQueue = [];
	let lastClaimAt = 0;
	let backoffMs = 1000;

	async function ensureGroup() {
		try {
			await redis.xgroup("CREATE", STREAM_KEY, GROUP, "0", "MKSTREAM");
		} catch (error) {
			if (!String(error?.message ?? error).includes("BUSYGROUP")) throw error;
		}
	}

	async function enqueue(event) {
		await redis.xadd(
			STREAM_KEY,
			"MAXLEN",
			"~",
			String(MAXLEN),
			"*",
			"path",
			event.path,
			"userId",
			event.userId ?? "",
			"organizationId",
			event.organizationId ?? "",
			"createdAt",
			event.createdAt,
		);
	}

	async function writeBatch() {
		if (retryQueue.length === 0) return;
		const batch = retryQueue;
		const data = batch.map(({ id, fields }) => ({
			type: "PAGE_VIEW",
			path: fields.path,
			...(fields.userId ? { userId: fields.userId } : {}),
			...(fields.organizationId ? { organizationId: fields.organizationId } : {}),
			createdAt: fields.createdAt ? new Date(fields.createdAt) : new Date(Number(id.split("-")[0])),
		}));
		await prisma.monitoringEvent.createMany({ data });
		await redis.xack(STREAM_KEY, GROUP, ...batch.map((entry) => entry.id));
		retryQueue = [];
	}

	async function readNewMessages() {
		const reply = await redis.xreadgroup(
			"GROUP",
			GROUP,
			CONSUMER,
			"COUNT",
			String(BATCH_SIZE),
			"BLOCK",
			String(BLOCK_MS),
			"STREAMS",
			STREAM_KEY,
			">",
		);
		if (!reply || reply.length === 0) return;
		for (const [, entries] of reply) {
			for (const entry of entries) {
				retryQueue.push(parseEntry(entry));
			}
		}
	}

	async function claimStaleMessages(now) {
		if (now - lastClaimAt < CLAIM_INTERVAL_MS) return;
		lastClaimAt = now;
		const reply = await redis.xautoclaim(
			STREAM_KEY,
			GROUP,
			CONSUMER,
			String(CLAIM_MIN_IDLE_MS),
			"0-0",
			"COUNT",
			String(BATCH_SIZE),
		);
		if (!reply || !Array.isArray(reply[1])) return;
		for (const entry of reply[1]) {
			retryQueue.push(parseEntry(entry));
		}
	}

	async function run() {
		let groupReady = false;
		while (running) {
			try {
				if (!groupReady) {
					await ensureGroup();
					groupReady = true;
					lastClaimAt = Date.now();
				}
				await writeBatch();
				await readNewMessages();
				if (retryQueue.length > 0) await writeBatch();
				await claimStaleMessages(Date.now());
				backoffMs = 1000;
			} catch (error) {
				logger.error(
					`Page-view queue write failed (retrying in ${backoffMs}ms, ${retryQueue.length} buffered):`,
					error?.message ?? error,
				);
				await sleep(backoffMs);
				backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
			}
		}
	}

	return {
		async start() {
			if (running) return;
			running = true;
			loopPromise = run();
		},
		enqueue,
		async stop() {
			if (!running) return;
			running = false;
			if (loopPromise) await loopPromise;
			try {
				await writeBatch();
			} catch (error) {
				logger.error("Page-view queue final flush failed:", error?.message ?? error);
			}
		},
	};
}
