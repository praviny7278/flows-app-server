import "dotenv/config";
import { createApp } from "./app.js";
import { createLogger } from "./logger.js";

const logger = createLogger("server");
const port = Number(process.env.PORT ?? "4000");
const shutdownTimeoutMs = 15_000;

const app = createApp();
const server = app.listen(port, () => {
	logger.info(`FlowOps API listening on http://localhost:${port}`, {
		env: process.env.NODE_ENV ?? "development",
		pid: process.pid,
	});
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

server.on("error", (error) => {
	logger.error("HTTP server error", error);
});

let shuttingDown = false;

async function shutdown(signal) {
	if (shuttingDown) return;
	shuttingDown = true;
	logger.info(`${signal} received, shutting down gracefully...`);

	const forceExit = setTimeout(() => {
		logger.error("Graceful shutdown timed out, forcing exit.");
		process.exit(1);
	}, shutdownTimeoutMs);
	forceExit.unref();

	const closed = new Promise((resolve) => server.close(resolve));
	server.closeIdleConnections?.();
	await closed;

	try {
		await app.locals.pageViewQueue?.stop();
	} catch (error) {
		logger.error("Error stopping page-view queue:", error?.message ?? error);
	}
	try {
		await app.locals.redis?.quit();
	} catch (error) {
		logger.error("Error closing Redis connection:", error?.message ?? error);
	}
	try {
		await app.locals.prisma?.$disconnect();
	} catch (error) {
		logger.error("Error closing Prisma connection:", error?.message ?? error);
	}

	logger.info("Shutdown complete.");
	process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
	logger.error("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (error) => {
	logger.error("Uncaught exception", error);
	void shutdown("uncaughtException");
});
