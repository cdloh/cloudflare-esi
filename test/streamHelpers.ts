import { fetchFunction } from "../src";

export const esiHead = {
  "Content-Type": "text/html",
  "Surrogate-Control": `content="ESI/1.0"`,
};

export type Route = (
  request: Request,
  ctx: Request[],
) => Response | Promise<Response>;

/**
 * Builds a fetcher out of a map of pathname (plus search if given) to handler.
 * Unmatched requests throw so a typo in a test is loud.
 *
 * @param {object} routes map of path to handler
 * @param {Function} [onFetch] called for each request that arrives
 * @returns {fetchFunction} fetcher
 */
export function routeFetcher(
  routes: { [path: string]: Route },
  onFetch?: (request: Request, ctx: Request[]) => void,
): fetchFunction {
  return async (request, ctx) => {
    const url = new URL(request.url);
    if (onFetch) onFetch(request, ctx);
    const route = routes[url.pathname + url.search] || routes[url.pathname];
    if (!route) {
      throw new Error(`No route for ${url.pathname}${url.search}`);
    }
    return route(request, ctx);
  };
}

export const esiResponse = (body: BodyInit | null): Response =>
  new Response(body, { headers: esiHead });

export const url = (path: string): Request =>
  new Request(`http://localhost${path}`);

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A promise you can resolve from outside
 *
 * @returns {object} the promise and its resolve function
 */
export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export type GeneratedStats = {
  /** bytes the source has been asked for so far */
  produced: number;
  /** set once the source has been cancelled */
  cancelled: boolean;
  /** set once the source has produced everything */
  completed: boolean;
};

/**
 * Generates a stream of `total` bytes, on demand only (pull based). Used to prove nothing reads further ahead than needed.
 *
 * @param {number} total total bytes
 * @param {number} chunkSize size of each chunk
 * @param {GeneratedStats} stats object updated as the stream is read
 * @param {string} [prefix] bytes (as text) to emit before the generated data
 * @param {number} [fill] byte to fill with
 * @returns {ReadableStream<Uint8Array>} stream
 */
export function generatedStream(
  total: number,
  chunkSize: number,
  stats: GeneratedStats,
  prefix = "",
  fill = 120, // x
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let sentPrefix = false;
  // Byte streams only get pulled when someone is waiting for data
  return new ReadableStream(
    {
      type: "bytes",
      pull(controller) {
        if (!sentPrefix) {
          sentPrefix = true;
          if (prefix) {
            controller.enqueue(encoder.encode(prefix));
            stats.produced += prefix.length;
            return;
          }
        }
        const remaining = total - (stats.produced - prefix.length);
        if (remaining <= 0) {
          stats.completed = true;
          controller.close();
          return;
        }
        const size = Math.min(chunkSize, remaining);
        controller.enqueue(new Uint8Array(size).fill(fill));
        stats.produced += size;
      },
      cancel() {
        stats.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
}

/**
 * Reads a body chunk by chunk, counting bytes
 *
 * @param {Response} res response
 * @param {Function} onChunk called with each chunk and the running total of bytes
 * @returns {Promise<number>} total bytes
 */
export async function drain(
  res: Response,
  onChunk?: (chunk: Uint8Array, total: number) => void | Promise<void>,
): Promise<number> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (onChunk) await onChunk(value, total);
  }
  return total;
}
