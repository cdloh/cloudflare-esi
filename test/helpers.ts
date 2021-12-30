import { IncomingMessage, ServerResponse } from "http";

// little shim to make it easier to copy tests from the current ledge repo
const say = function (this: any, string: string) {
  this.write(`${string}\n`);
};

export type testResponse = ServerResponse & { say: (string: string) => void };
type handler = (req: IncomingMessage, res: testResponse) => void;
type urlHandlerConfig = {
  persist?: boolean;
  count?: number;
};
type route = {
  handle: handler;
  config: urlHandlerConfig;
};

export class urlHandler {
  #routes: { [key: string]: route };
  constructor() {
    this.#routes = {};

    this.add = this.add.bind(this);
    this.route = this.route.bind(this);
    this.verify = this.verify.bind(this);
    this.clean = this.clean.bind(this);
  }

  add(url: string, handle: handler, config?: urlHandlerConfig): void {
    const defaultConfig = {
      persist: false,
      count: 1,
    };
    this.#routes[url] = {
      handle: handle,
      config: { ...defaultConfig, ...config },
    };
  }

  async route(req: IncomingMessage, res: testResponse): Promise<void> {
    if ((req.url as string) in this.#routes) {
      res.say = say;
      const route = this.#routes[req.url as string];
      const returnValue = route.handle;

      if (route.config.count === 1) {
        delete this.#routes[req.url as string];
        return returnValue(req, res);
      }

      this.#routes[req.url as string].config.count =
        (route.config.count as number) - 1;
      return returnValue(req, res);
    } else {
      console.error("TEST ROUTER: No route matched: ", req.url);
      res.writeHead(500);
      res.end();
      fail();
    }
  }

  verify(): boolean {
    const count = Object.keys(this.#routes).length;
    this.#routes = {};
    return count === 0;
  }

  clean(): void {
    this.#routes = {};
  }
}

export function checkSurrogate(res: Response): boolean {
  return res.headers.get("Surrogate-Control") == null;
}
