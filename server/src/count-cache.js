const store = new Map();
const MAX_ENTRIES = 2_000;

export async function cachedCount(key, ttlMs, loader) {
	const now = Date.now();
	const entry = store.get(key);
	if (entry && entry.expiresAt > now) return entry.value;

	const value = await loader();
	if (store.size >= MAX_ENTRIES) {
		for (const [candidateKey, candidate] of store) {
			if (candidate.expiresAt <= now || store.size >= MAX_ENTRIES) store.delete(candidateKey);
		}
	}
	store.set(key, { value, expiresAt: now + ttlMs });
	return value;
}

export function invalidateCounts(prefix) {
	if (!prefix) {
		store.clear();
		return;
	}
	for (const key of store.keys()) {
		if (key.startsWith(prefix)) store.delete(key);
	}
}
