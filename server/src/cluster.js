import "dotenv/config";
import cluster from "node:cluster";
import os from "node:os";
import { createLogger } from "./logger.js";

const logger = createLogger("cluster");

const workerCount = Number(
	process.env.WORKERS ?? Math.min(os.availableParallelism?.() ?? os.cpus().length, 4),
);

if (cluster.isPrimary) {
	logger.info(`Primary ${process.pid} starting ${workerCount} workers`);

	let shuttingDown = false;
	const shutdown = () => {
		shuttingDown = true;
		for (const worker of Object.values(cluster.workers ?? {})) worker?.kill("SIGTERM");
		setTimeout(() => process.exit(0), 16_000).unref();
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	cluster.on("exit", (worker, code, signal) => {
		if (shuttingDown) return;
		logger.error(`Worker ${worker.process.pid} exited (${signal ?? code}); restarting...`);
		cluster.fork();
	});

	for (let index = 0; index < workerCount; index += 1) cluster.fork();
} else {
	await import("./index.js");
}
