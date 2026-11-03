// Test helpers: the parser makes its fragment requests via global fetch, and
// workerd can't listen on sockets, so instead of a real HTTP server we mock
// outbound requests with MSW (see network.ts / setup.ts).
import { http, type HttpHandler } from "msw";
import { network, unmatched } from "./network";

export const testingDetails = {
  port: 8787,
  hostname: "localhost",
  proto: "http:",
  url: `http://localhost:8787`,
};

type handler = (req: Request) => Response | Promise<Response>;
type urlHandlerConfig = {
  persist?: boolean;
  count?: number;
};
/**
 * Thin wrapper around MSW: register a handler for an exact URL, hit it once.
 */
export class urlHandler {
  constructor() {
    this.add = this.add.bind(this);
    this.verify = this.verify.bind(this);
    this.clean = this.clean.bind(this);
  }

  /**
   * Register a handler.
   * Local routes are keyed by path + query ("/foo?a=1").
   * Anything on another host is keyed by its full URL ("https://example.com/foo").
   *
   * @param {string} url route key
   * @param {handler} handle handler to run
   * @param {urlHandlerConfig} config how many times the route can be hit
   */
  add(url: string, handle: handler, config?: urlHandlerConfig): void {
    const count = config?.count ?? 1;
    const absolute = url.startsWith("/") ? testingDetails.url + url : url;
    for (let i = 0; i < count; i++) {
      network.use(
        // A predicate rather than a path: MSW path matching ignores the query string
        http.all(
          ({ request }) => request.url === new URL(absolute).toString(),
          ({ request }) => handle(request as unknown as Request),
          { once: true },
        ),
      );
    }
  }

  verify(): boolean {
    const unused = network
      .listHandlers()
      .filter((h) => !(h as HttpHandler).isUsed).length;
    const unmatchedCount = unmatched.length;
    this.clean();
    return unused === 0 && unmatchedCount === 0;
  }

  clean(): void {
    network.resetHandlers();
    unmatched.length = 0;
  }
}

/**
 * Small builder for canned responses, so handlers read like a writer
 * (`reply(200, headers).say("a").end("b")`).
 */
class Reply {
  #chunks: string[] = [];
  constructor(
    private status: number,
    private headers: Record<string, string>,
  ) {}

  write(chunk: string): this {
    this.#chunks.push(chunk);
    return this;
  }

  /** Write a chunk followed by a newline */
  say(chunk: string): this {
    return this.write(`${chunk}\n`);
  }

  end(chunk?: string): Response {
    if (chunk !== undefined) this.write(chunk);
    return new Response(this.#chunks.join(""), {
      status: this.status,
      headers: this.headers,
    });
  }
}

export function reply(
  status: number = 200,
  headers: Record<string, string> = {},
): Reply {
  return new Reply(status, headers);
}

/**
 * Request headers as [name, value] pairs, host first (as a real server would see them)
 *
 * @param {Request} req incoming request
 * @returns {[string, string][]} header pairs
 */
export function requestHeaders(req: Request): [string, string][] {
  return [["host", new URL(req.url).host], ...req.headers];
}

export function checkSurrogate(res: Response): boolean {
  return res.headers.get("Surrogate-Control") == null;
}
