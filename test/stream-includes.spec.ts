import { describe, expect, test } from "vitest";
import { esi, ESIConfig } from "../src";
import {
  deferred,
  drain,
  esiHead,
  esiResponse,
  generatedStream,
  GeneratedStats,
  routeFetcher,
  sleep,
  url,
} from "./streamHelpers";

const config: ESIConfig = { contentTypes: ["text/html", "text/plain"] };

const MB = 1024 * 1024;

test("STREAM 1: includes are written in document order around surrounding text", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(
        `A<esi:include src="/one" />B<esi:include src="/two" />C<esi:include src="/three" />D`,
      ),
    "/one": async () => {
      await sleep(40);
      return new Response("1");
    },
    "/two": () => new Response("2"),
    "/three": async () => {
      await sleep(10);
      return esiResponse("3<esi:include src='/nested' />".replace(/'/g, '"'));
    },
    "/nested": () => new Response("n"),
  });
  const res = await new esi({ ...config, fetcher }).parse(url("/root"));
  expect(await res.text()).toEqual("A1B2C3nD");
});

test("STREAM 2: several includes in the one ESI chunk keep their order", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(
        `<!--esi before <esi:include src="/one" /> middle <esi:include src="/two" /> after -->`,
      ),
    "/one": async () => {
      await sleep(20);
      return new Response("1");
    },
    "/two": () => new Response("2"),
  });
  const res = await new esi({ ...config, fetcher }).parse(url("/root"));
  expect(await res.text()).toEqual(" before 1 middle 2 after ");
});

test("STREAM 3: ESI vars and escaping in the text around an include still work", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(
        [
          `<esi:vars>$(QUERY_STRING{a})</esi:vars>|`,
          `<!--esi <esi:vars>$(QUERY_STRING{a})</esi:vars> <esi:include src="/frag" /> <esi:vars>$(QUERY_STRING{b})</esi:vars>-->|`,
          `<esi:choose><esi:when test="$(QUERY_STRING{a}) == 'x'">in-when $(QUERY_STRING{b}) <esi:include src="/frag" /> after-$(QUERY_STRING{b})</esi:when></esi:choose>|`,
          `<esi:vars>$(RAW_QUERY_STRING{b})</esi:vars>`,
        ].join(""),
      ),
    "/frag": () => new Response("FRAG"),
  });
  const res = await new esi({ ...config, fetcher }).parse(
    url("/root?a=x&b=%3Cb%3E"),
  );
  expect(await res.text()).toEqual(
    `x| x FRAG &lt;b&gt;|in-when &lt;b&gt; FRAG after-&lt;b&gt;|<b>`,
  );
});

test("STREAM 4: empty includes", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(
        `[<esi:include src="/null" />][<esi:include src="/empty" />][<esi:include src="/esi-empty" />]`,
      ),
    "/null": () => new Response(null),
    "/empty": () => new Response(""),
    "/esi-empty": () => esiResponse(""),
  });
  const res = await new esi({ ...config, fetcher }).parse(url("/root"));
  expect(await res.text()).toEqual("[][][]");
});

test("STREAM 5: a fetcher error drops that chunk only, as before", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(
        `A<esi:include src="/ok" />B<!--esi dropped <esi:include src="/ok" /><esi:include src="/boom" />-->C<esi:include src="/ok" />D`,
      ),
    "/ok": () => new Response("ok"),
    "/boom": () => {
      throw new Error("boom");
    },
  });
  const originalLog = console.log;
  console.log = () => undefined;
  try {
    const res = await new esi({ ...config, fetcher }).parse(url("/root"));
    expect(await res.text()).toEqual("AokBCokD");
  } finally {
    console.log = originalLog;
  }
});

test("STREAM 6: includes that error part way don't take the parent down", async () => {
  const fetcher = routeFetcher({
    "/root": () => esiResponse(`A<esi:include src="/bad" />B`),
    "/bad": () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
          },
          pull() {
            throw new Error("broke");
          },
        }),
      ),
  });
  const res = await new esi({ ...config, fetcher }).parse(url("/root"));
  expect(await res.text()).toEqual("ApartialB");
});

test("STREAM 7: header propagation and recursion info still reach the include", async () => {
  const seen: Request[] = [];
  const fetcher = routeFetcher(
    {
      "/root": () => esiResponse(`<esi:include src="/frag" />`),
      "/frag": () => new Response("x"),
    },
    (req) => seen.push(req),
  );
  const parent = new Request("http://localhost/root", {
    headers: {
      Authorization: "bar",
      Cookie: "foo=1",
      "Cache-Control": "no-cache",
    },
  });
  const res = await new esi({ ...config, fetcher }).parse(parent);
  expect(await res.text()).toEqual("x");
  const frag = seen[1];
  expect(frag.headers.get("X-ESI-Recursion-Level")).toEqual("1");
  expect(frag.headers.get("X-ESI-Parent-URI")).toEqual("http://localhost/root");
  expect(frag.headers.get("Authorization")).toEqual("bar");
  expect(frag.headers.get("Cookie")).toEqual("foo=1");
  expect(frag.headers.get("Cache-Control")).toEqual("no-cache");
});

test("STREAM 8: a later include waits as a stream and isn't read ahead while an earlier one is pending", async () => {
  const gate = deferred();
  const second: GeneratedStats = {
    produced: 0,
    cancelled: false,
    completed: false,
  };
  const fetched: string[] = [];
  const fetcher = routeFetcher(
    {
      "/root": () =>
        esiResponse(`<esi:include src="/slow" />|<esi:include src="/big" />`),
      "/slow": async () => {
        await gate.promise;
        return new Response("slow");
      },
      "/big": () =>
        new Response(generatedStream(20 * MB, 64 * 1024, second, "", 98)),
    },
    (req) => fetched.push(new URL(req.url).pathname),
  );
  const res = await new esi({ ...config, fetcher }).parse(url("/root"));

  // Both includes are fetched straight away as they always have been
  await sleep(50);
  expect(fetched).toEqual(["/root", "/slow", "/big"]);
  // but while /slow is pending /big is not being read beyond normal queueing
  expect(second.produced).toBeLessThanOrEqual(2 * 64 * 1024);

  gate.resolve();
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  let total = 0;
  let maxLag = 0;
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toEqual("slow");
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    maxLag = Math.max(maxLag, second.produced - total);
  }
  expect(total).toEqual(20 * MB + 1);
  expect(maxLag).toBeLessThan(1 * MB);
});

describe("large includes stay bounded", () => {
  const total = 20 * MB;
  const chunk = 64 * 1024;

  const run = async (nested: "raw" | "esi") => {
    const stats: GeneratedStats = {
      produced: 0,
      cancelled: false,
      completed: false,
    };
    const fetcher = routeFetcher({
      "/root": () =>
        esiResponse(
          `<esi:include src="/big?a=Q" />|<esi:include src="/after" />`,
        ),
      "/big": () =>
        nested === "raw"
          ? new Response(generatedStream(total, chunk, stats), {
              headers: { "Content-Type": "application/octet-stream" },
            })
          : new Response(
              generatedStream(
                total,
                chunk,
                stats,
                `<esi:vars>$(QUERY_STRING{a})</esi:vars>`,
              ),
              { headers: esiHead },
            ),
      "/after": () => new Response("after"),
    });
    const res = await new esi({ ...config, fetcher }).parse(url("/root?a=Q"));

    let producedAtFirstByte = -1;
    let maxLag = 0;
    let consumed = 0;
    const bytes = await drain(res, async (value, running) => {
      if (producedAtFirstByte === -1) {
        producedAtFirstByte = stats.produced;
      }
      consumed = running;
      maxLag = Math.max(maxLag, stats.produced - consumed);
      // A consumer that isn't instant
      if (running % (4 * MB) < chunk) await sleep(1);
    });
    return { stats, bytes, producedAtFirstByte, maxLag };
  };

  test("STREAM 9: 20MB non-ESI include is never read to completion before the parent writes it", async () => {
    const { stats, bytes, producedAtFirstByte, maxLag } = await run("raw");
    expect(stats.completed).toBe(true);
    expect(bytes).toEqual(total + 1 + "after".length);
    expect(producedAtFirstByte).toBeLessThan(1 * MB);
    expect(maxLag).toBeLessThan(1 * MB);
    console.info(
      `[memory] raw include: ${total} bytes, produced at first byte ${producedAtFirstByte}, max produced-but-unconsumed ${maxLag}`,
    );
  });

  test("STREAM 10: 20MB ESI include is never read to completion before the parent writes it", async () => {
    const { stats, bytes, producedAtFirstByte, maxLag } = await run("esi");
    expect(stats.completed).toBe(true);
    // ESI vars replaced $(QUERY_STRING{a}) with Q
    expect(bytes).toEqual(total + 1 + 1 + "after".length);
    expect(producedAtFirstByte).toBeLessThan(2 * MB);
    // The nested parser may queue up to its read ahead limit (1MB) plus a few chunks
    expect(maxLag).toBeLessThan(3 * MB);
    console.info(
      `[memory] ESI include: ${total} bytes, produced at first byte ${producedAtFirstByte}, max produced-but-unconsumed ${maxLag}`,
    );
  });

  test("STREAM 11: if the parent isn't read, a large include isn't either", async () => {
    const stats: GeneratedStats = {
      produced: 0,
      cancelled: false,
      completed: false,
    };
    const fetcher = routeFetcher({
      "/root": () => esiResponse(`<esi:include src="/big" />`),
      "/big": () => new Response(generatedStream(total, chunk, stats)),
    });
    const res = await new esi({ ...config, fetcher }).parse(url("/root"));
    await sleep(100);
    expect(stats.completed).toBe(false);
    expect(stats.produced).toBeLessThan(1 * MB);
    // and it all still arrives once someone reads
    expect(await drain(res)).toEqual(total);
  });
});

test("STREAM 12: the client going away mid include cancels every source and skips the post body function", async () => {
  const big: GeneratedStats = {
    produced: 0,
    cancelled: false,
    completed: false,
  };
  const queued: GeneratedStats = {
    produced: 0,
    cancelled: false,
    completed: false,
  };
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(`A<esi:include src="/big" />B<esi:include src="/queued" />C`),
    "/big": () => new Response(generatedStream(50 * MB, 64 * 1024, big)),
    "/queued": () => new Response(generatedStream(50 * MB, 64 * 1024, queued)),
  });
  let postBodyCalls = 0;
  const res = await new esi({
    ...config,
    fetcher,
    postBodyFunction: () => {
      postBodyCalls++;
    },
  }).parse(url("/root"));
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  await reader.read();
  await reader.read();
  await reader.cancel(new Error("stop"));
  await sleep(50);

  // the include being streamed
  expect(big.cancelled).toBe(true);
  expect(big.completed).toBe(false);
  // and the one queued behind it which was never read
  expect(queued.cancelled).toBe(true);
  expect(queued.produced).toEqual(0);
  expect(postBodyCalls).toEqual(0);
});
