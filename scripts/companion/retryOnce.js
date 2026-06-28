/**
 * Retry an async operation once on failure; return fallback on second failure.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ fallback?: T, label?: string }} opts
 * @returns {Promise<{ ok: boolean, value: T, error?: Error }>}
 */
export async function retryOnce(fn, opts = {}) {
    const { fallback = null, label = 'operation' } = opts;
    try {
        return { ok: true, value: await fn() };
    } catch (first) {
        console.warn(`[Pipeline] ${label} failed, retrying once:`, first.message);
        try {
            return { ok: true, value: await fn() };
        } catch (second) {
            console.error(`[Pipeline] ${label} failed after retry:`, second.message);
            return { ok: false, value: fallback, error: second };
        }
    }
}
