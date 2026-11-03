import { expect, test } from "vitest";
import {
  esi,
  ESIConfig,
  ESIDocumentReport,
  ESIIncludeCompleteInfo,
  ESIIncludeStartInfo,
} from "../src";
import {
  deferred,
  esiResponse,
  generatedStream,
  GeneratedStats,
  routeFetcher,
  sleep,
  url,
} from "./streamHelpers";

const config: ESIConfig = { contentTypes: ["text/html", "text/plain"] };

type Sink = {
  writable: WritableStream<Uint8Array>;
  text: () => string;
  chunks: number;
  closed: boolean;
  aborted: boolean;
  reason?: unknown;
};

/**
 * A writable that records what it was given and how it ended
 *
 * @param {Promise<void>} [gate] if given every write waits for this
 * @returns {Sink} sink
 */
function sink(gate?: Promise<void>): Sink {
  const received: Uint8Array[] = [];
  const result: Sink = {
    chunks: 0,
    closed: false,
    aborted: false,
    text: () => {
      const decoder = new TextDecoder();
      return (
        received.map((c) => decoder.decode(c, { stream: true })).join("") +
        decoder.decode()
      );
    },
    writable: new WritableStream<Uint8Array>(
      {
        async write(chunk) {
          if (gate) await gate;
          // keep it. A tap getting the parent's buffer would see it change
          received.push(chunk);
          result.chunks++;
        },
        close() {
          result.closed = true;
        },
        abort(reason) {
          result.aborted = true;
          result.reason = reason;
        },
      },
      { highWaterMark: 1 },
    ),
  };
  return result;
}

const path = (r: Request) => new URL(r.url).pathname;

test("TAP 1: gets exactly what was spliced into the parent, nested includes already inlined", async () => {
  const sinks: { [path: string]: Sink } = {};
  const starts: ESIIncludeStartInfo[] = [];
  const completes: ESIIncludeCompleteInfo[] = [];
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(`A<esi:include src="/a?x=1" />B<esi:include src="/b" />C`),
    "/a": () =>
      esiResponse(
        `a1 <esi:vars>$(QUERY_STRING{x})</esi:vars> <esi:include src="/deep" /> a2`,
      ),
    "/deep": () => new Response("DEEP"),
    "/b": () => new Response("bbb"),
  });
  const res = await new esi({
    ...config,
    onIncludeStart: (info) => {
      starts.push(info);
      return (sinks[path(info.request)] = sink()).writable;
    },
    onIncludeComplete: (info) => {
      completes.push(info);
    },
    fetcher,
  }).parse(url("/root"));
  const out = await res.text();
  expect(out).toEqual("Aa1 1 DEEP a2BbbbC");

  // Every include is offered once. Never the root
  expect(starts.map((s) => path(s.request)).sort()).toEqual([
    "/a",
    "/b",
    "/deep",
  ]);
  expect(sinks["/a"].text()).toEqual("a1 1 DEEP a2");
  expect(sinks["/deep"].text()).toEqual("DEEP");
  expect(sinks["/b"].text()).toEqual("bbb");

  // Completed cleanly. Closed not aborted
  for (const s of Object.values(sinks)) {
    expect(s.closed).toBe(true);
    expect(s.aborted).toBe(false);
  }
  expect(completes.length).toEqual(3);
  for (const c of completes) {
    expect(c.aborted).toBe(false);
    expect(c.error).toBeUndefined();
  }

  const a = starts.find((s) => path(s.request) == "/a") as ESIIncludeStartInfo;
  expect(a.recursion).toEqual(1);
  expect(a.ctx.map(path)).toEqual(["/root"]);
  expect(new URL(a.request.url).search).toEqual("?x=1");
  const deep = starts.find(
    (s) => path(s.request) == "/deep",
  ) as ESIIncludeStartInfo;
  expect(deep.recursion).toEqual(2);
  expect(deep.ctx.map(path)).toEqual(["/root", "/a"]);
});

test("TAP 2: onIncludeComplete runs after every onDocumentProcessed for the include's subtree", async () => {
  const events: string[] = [];
  const reports: ESIDocumentReport[] = [];
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(`<esi:include src="/a" /><esi:include src="/plain" />`),
    "/a": () =>
      esiResponse(`<esi:include src="/b" /><esi:include src="/plain" />`),
    "/b": () => esiResponse(`<esi:include src="/c" />`),
    "/c": () => esiResponse("c"),
    "/plain": () => new Response("plain"),
  });
  const res = await new esi({
    ...config,
    onDocumentProcessed: async (report) => {
      // reports can be slow
      await sleep(path(report.request) == "/c" ? 15 : 1);
      reports.push(report);
      events.push(`report ${path(report.request)}`);
    },
    onIncludeStart: () => undefined,
    onIncludeComplete: (info) => {
      events.push(`complete ${path(info.request)}`);
    },
    fetcher,
  }).parse(url("/root"));
  expect(await res.text()).toEqual("cplainplain");

  const completes = events.filter((e) => e.startsWith("complete "));
  expect(completes.length).toEqual(5);
  for (const complete of completes) {
    const include = complete.replace("complete ", "");
    const at = events.indexOf(complete);
    // everything in the subtree of the include that completed
    const inSubtree = reports.filter(
      (r) =>
        path(r.request) == include ||
        r.ctx.some((c) => path(c) == include && r.recursion > 0),
    );
    expect(inSubtree.length).toBeGreaterThan(0);
    for (const report of inSubtree) {
      // The root is in the ctx of everything but is never an include
      if (path(report.request) == "/root") continue;
      expect(events.indexOf(`report ${path(report.request)}`)).toBeLessThan(at);
    }
  }
  // and the root's own report is in before the body ended
  expect(events[events.length - 1]).toEqual("report /root");
});

test("TAP 3: a missing, async or throwing onIncludeStart never changes the output", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(
        `<esi:include src="/a" />|<esi:include src="/b" />|<esi:include src="/c" />`,
      ),
    "/a": () => new Response("a"),
    "/b": () => new Response("b"),
    "/c": () => new Response("c"),
  });
  const completed: string[] = [];
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const res = await new esi({
      ...config,
      onIncludeStart: async (info) => {
        const p = path(info.request);
        if (p == "/a") return undefined;
        if (p == "/b") throw new Error("start threw");
        await sleep(5);
        return sink().writable;
      },
      onIncludeComplete: (info) => {
        completed.push(path(info.request));
      },
      fetcher,
    }).parse(url("/root"));
    expect(await res.text()).toEqual("a|b|c");
  } finally {
    console.error = originalError;
  }
  expect(completed.sort()).toEqual(["/a", "/b", "/c"]);
});

test("TAP 4: a throwing onIncludeComplete is swallowed", async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const fetcher = routeFetcher({
      "/root": () => esiResponse(`<esi:include src="/a" />!`),
      "/a": () => new Response("a"),
    });
    const res = await new esi({
      ...config,
      onIncludeComplete: () => {
        throw new Error("complete threw");
      },
      fetcher,
    }).parse(url("/root"));
    expect(await res.text()).toEqual("a!");
  } finally {
    console.error = originalError;
  }
});

test("TAP 5: a tap that falls behind is aborted and the parent carries on", async () => {
  const gate = deferred();
  const slow = sink(gate.promise);
  const completes: ESIIncludeCompleteInfo[] = [];
  const stats: GeneratedStats = {
    produced: 0,
    cancelled: false,
    completed: false,
  };
  const fetcher = routeFetcher({
    "/root": () => esiResponse(`before|<esi:include src="/big" />|after`),
    "/big": () => new Response(generatedStream(100 * 1000, 1000, stats)),
  });
  const res = await new esi({
    ...config,
    includeTapHighWaterMark: 10 * 1000,
    onIncludeStart: () => slow.writable,
    onIncludeComplete: (info) => {
      completes.push(info);
    },
    fetcher,
  }).parse(url("/root"));

  // The parent isn't held up by the tap which is stuck on its first write
  const out = await res.text();
  expect(out.length).toEqual("before||after".length + 100 * 1000);
  expect(out.startsWith("before|x")).toBe(true);
  expect(out.endsWith("x|after")).toBe(true);
  expect(stats.completed).toBe(true);
  expect(completes.length).toEqual(1);
  expect(completes[0].aborted).toBe(false);

  // Let the tap's writable move. It then sees the abort
  gate.resolve();
  await sleep(20);
  expect(slow.closed).toBe(false);
  expect(slow.aborted).toBe(true);
  expect(slow.reason).toBeInstanceOf(Error);
  // and got nowhere near all of it
  expect(slow.text().length).toBeLessThan(100 * 1000);
});

test("TAP 6: a tap that keeps up gets everything even if it's slower than the parent per chunk", async () => {
  const written: string[] = [];
  let closed = false;
  const chunks = ["one-", "two-", "three-", "four"];
  const fetcher = routeFetcher({
    "/root": () => esiResponse(`<esi:include src="/a" />`),
    "/a": () =>
      new Response(
        new ReadableStream({
          type: "bytes",
          pull(controller) {
            const next = chunks.shift();
            if (next === undefined) {
              controller.close();
              return;
            }
            controller.enqueue(new TextEncoder().encode(next));
          },
        }),
      ),
  });
  const res = await new esi({
    ...config,
    onIncludeStart: () =>
      new WritableStream<Uint8Array>({
        async write(chunk) {
          await sleep(3);
          written.push(new TextDecoder().decode(chunk));
        },
        close() {
          closed = true;
        },
      }),
    fetcher,
  }).parse(url("/root"));
  expect(await res.text()).toEqual("one-two-three-four");
  await sleep(30);
  expect(written.join("")).toEqual("one-two-three-four");
  expect(closed).toBe(true);
});

test("TAP 7: the client going away aborts taps rather than closing them, and reports it", async () => {
  const stats: GeneratedStats = {
    produced: 0,
    cancelled: false,
    completed: false,
  };
  const tap = sink();
  const completes: ESIIncludeCompleteInfo[] = [];
  const fetcher = routeFetcher({
    "/root": () => esiResponse(`A<esi:include src="/big" />B`),
    "/big": () =>
      new Response(generatedStream(50 * 1024 * 1024, 64 * 1024, stats)),
  });
  const res = await new esi({
    ...config,
    onIncludeStart: () => tap.writable,
    onIncludeComplete: (info) => {
      completes.push(info);
    },
    fetcher,
  }).parse(url("/root"));

  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  await reader.read();
  await reader.read();
  const reason = new Error("stop");
  await reader.cancel(reason);
  await sleep(30);

  expect(tap.closed).toBe(false);
  expect(tap.aborted).toBe(true);
  // Reasons are copied as they cross native streams
  expect((tap.reason as Error).message).toEqual(reason.message);
  expect(completes.length).toEqual(1);
  expect(completes[0].aborted).toBe(true);
});

test("TAP 8: an include whose body errors aborts its tap, reports the error, and the parent carries on", async () => {
  const tap = sink();
  const completes: ESIIncludeCompleteInfo[] = [];
  const boom = new Error("include broke");
  const fetcher = routeFetcher({
    "/root": () => esiResponse(`A<esi:include src="/bad" />B`),
    "/bad": () =>
      new Response(
        new ReadableStream({
          type: "bytes",
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
          },
          pull(controller) {
            controller.error(boom);
          },
        }),
      ),
  });
  const res = await new esi({
    ...config,
    onIncludeStart: () => tap.writable,
    onIncludeComplete: (info) => {
      completes.push(info);
    },
    fetcher,
  }).parse(url("/root"));
  expect(await res.text()).toEqual("ApartialB");
  await sleep(10);
  expect(tap.closed).toBe(false);
  expect(tap.aborted).toBe(true);
  expect(tap.reason).toBe(boom);
  expect(completes.length).toEqual(1);
  expect(completes[0].error).toBe(boom);
  expect(completes[0].aborted).toBe(false);
});

test("TAP 9: an include with no body is still offered and closes empty", async () => {
  const tap = sink();
  const fetcher = routeFetcher({
    "/root": () => esiResponse(`A<esi:include src="/empty" />B`),
    "/empty": () => new Response(null),
  });
  const res = await new esi({
    ...config,
    onIncludeStart: () => tap.writable,
    fetcher,
  }).parse(url("/root"));
  expect(await res.text()).toEqual("AB");
  await sleep(10);
  expect(tap.closed).toBe(true);
  expect(tap.text()).toEqual("");
});

test("TAP 10: includes that never get fetched (not allowed, over the recursion limit) are not offered", async () => {
  const starts: string[] = [];
  const fetcher = routeFetcher({
    "/loop": () =>
      esiResponse(
        `x<esi:include src="/loop" /><esi:include src="http://other.example/" />`,
      ),
  });
  const res = await new esi({
    ...config,
    recursionLimit: 3,
    disableThirdPartyIncludes: true,
    onIncludeStart: (info) => {
      starts.push(`${info.recursion}`);
      return undefined;
    },
    fetcher,
  }).parse(url("/loop"));
  expect(await res.text()).toEqual("xxx");
  expect(starts.sort()).toEqual(["1", "2"]);
});
