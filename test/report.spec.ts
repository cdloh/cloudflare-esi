import { beforeEach, expect, test } from "vitest";
import { esi, ESIConfig, ESIDocumentReport } from "../src";
import {
  esiHead,
  esiResponse,
  routeFetcher,
  sleep,
  url,
} from "./streamHelpers";

let reports: ESIDocumentReport[];
let config: ESIConfig;

beforeEach(() => {
  reports = [];
  config = {
    contentTypes: ["text/html", "text/plain"],
    onDocumentProcessed: (report) => {
      reports.push(report);
    },
  };
});

const byPath = (path: string): ESIDocumentReport => {
  const found = reports.filter((r) => new URL(r.request.url).pathname == path);
  expect(found.length).toEqual(1);
  return found[0];
};

test("REPORT 1: fires once for the root and once for every include, after the body is done", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(
        `<esi:include src="/a" /> <esi:include src="/b" /> <esi:include src="/a" />`,
      ),
    "/a": () => esiResponse(`<esi:include src="/c" />`),
    "/b": () => new Response("plain"),
    "/c": () => new Response("c"),
  });
  const res = await new esi({ ...config, fetcher }).parse(url("/root"));
  expect(await res.text()).toEqual("c plain c");

  // All of them are in by the time the reader has seen the end of the body
  expect(reports.map((r) => new URL(r.request.url).pathname).sort()).toEqual([
    "/a",
    "/a",
    "/b",
    "/c",
    "/c",
    "/root",
  ]);
  const root = byPath("/root");
  expect(root.recursion).toEqual(0);
  expect(root.ctx).toEqual([]);
  expect(root.isESI).toBe(true);
  expect(root.aborted).toBe(false);
  expect(reports[reports.length - 1]).toBe(root);
  const b = byPath("/b");
  expect(b.recursion).toEqual(1);
  expect(b.ctx.length).toEqual(1);
  expect(new URL(b.ctx[0].url).pathname).toEqual("/root");
  const c = reports.filter((r) => new URL(r.request.url).pathname == "/c")[0];
  expect(c.recursion).toEqual(2);
  expect(c.ctx.map((r) => new URL(r.url).pathname)).toEqual(["/root", "/a"]);
});

test("REPORT 2: non ESI documents are reported with nothing in them", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      new Response(`<esi:vars>$(QUERY_STRING)</esi:vars>`, {
        headers: { "Content-Type": "text/html" },
      }),
  });
  const res = await new esi({ ...config, fetcher }).parse(url("/root?a=1"));
  expect(await res.text()).toEqual(`<esi:vars>$(QUERY_STRING)</esi:vars>`);
  expect(reports.length).toEqual(1);
  expect(reports[0]).toMatchObject({
    isESI: false,
    includes: [],
    usedVars: [],
    usedEsiArgs: [],
    usedConditionals: false,
    usedEsiVarsBlock: false,
    varsInIncludeSrc: false,
    recursionLimitHit: false,
    aborted: false,
    recursion: 0,
  });
});

test("REPORT 3: vars, esi args and esi:vars blocks", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(
        // The one not in a esi tag isn't evaluated by anything so doesn't count
        `$(HTTP_HOST) <esi:vars>$(HTTP_COOKIE{foo}) $(GEOIP_COUNTRY_CODE) $(QUERY_STRING) $(HTTP_COOKIE{foo}) $(ESI_ARGS{bar}) $(RAW_QUERY_STRING{a}) $(ESI_ARGS)|x</esi:vars>`,
      ),
  });
  const res = await new esi({ ...config, fetcher }).parse(
    url("/root?a=1&esi_bar=2"),
  );
  await res.text();
  const root = byPath("/root");
  expect(root.usedVars).toEqual([
    "HTTP_COOKIE{foo}",
    "GEOIP_COUNTRY_CODE",
    "QUERY_STRING",
    "ESI_ARGS{bar}",
    "QUERY_STRING{a}",
    "ESI_ARGS",
  ]);
  expect(root.usedEsiArgs).toEqual(["esi_bar", "esi_*"]);
  expect(root.usedEsiVarsBlock).toBe(true);
  expect(root.usedConditionals).toBe(false);
  expect(root.varsInIncludeSrc).toBe(false);
  // request as sent to the fetcher. No esi args
  expect(new URL(root.request.url).search).toEqual("?a=1");
  expect(root.response.headers.get("Content-Type")).toEqual("text/html");
});

test("REPORT 4: vars in untaken branches of esi:choose are still recorded", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(
        `<esi:choose><esi:when test="$(HTTP_COOKIE{a}) == 'yes'">$(QUERY_STRING{x})</esi:when><esi:when test="$(HTTP_ACCEPT_LANGUAGE{en}) == 'true'">$(QUERY_STRING{y})</esi:when><esi:otherwise>$(QUERY_STRING{z}) <esi:include src="/other?$(QUERY_STRING{q})" /></esi:otherwise></esi:choose>`,
      ),
    "/other": () => new Response("other"),
  });
  const res = await new esi({ ...config, fetcher }).parse(
    new Request("http://localhost/root?x=1", {
      headers: { Cookie: "a=yes" },
    }),
  );
  // First branch taken. The include is not
  expect(await res.text()).toEqual("1");
  const root = byPath("/root");
  expect(root.usedConditionals).toBe(true);
  expect(root.usedVars.sort()).toEqual(
    [
      "HTTP_COOKIE{a}",
      "QUERY_STRING{x}",
      "HTTP_ACCEPT_LANGUAGE{en}",
      "QUERY_STRING{y}",
      "QUERY_STRING{z}",
      "QUERY_STRING{q}",
    ].sort(),
  );
  expect(root.varsInIncludeSrc).toBe(true);
  // includes that weren't attempted aren't listed
  expect(root.includes).toEqual([]);
});

test("REPORT 5: includes are listed with their resolved url and third party status", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(
        `<esi:include src="/rel" /><esi:include src="/q?a=$(QUERY_STRING{a})" /><esi:include src="http://other.example/x" /><esi:include src="http://allowed.example/y" />`,
      ),
    "/rel": () => new Response("1"),
    "/q": () => new Response("2"),
    "/y": () => new Response("3"),
  });
  const res = await new esi({
    ...config,
    disableThirdPartyIncludes: true,
    thirdPartyIncludesDomainWhitelist: ["allowed.example"],
    fetcher,
  }).parse(url("/root?a=b"));
  expect(await res.text()).toEqual("123");
  const root = byPath("/root");
  expect(root.includes).toEqual([
    {
      src: "/rel",
      resolvedUrl: "http://localhost/rel",
      thirdParty: false,
      allowed: true,
    },
    {
      src: "/q?a=$(QUERY_STRING{a})",
      resolvedUrl: "http://localhost/q?a=b",
      thirdParty: false,
      allowed: true,
    },
    {
      src: "http://other.example/x",
      resolvedUrl: "http://other.example/x",
      thirdParty: true,
      allowed: false,
    },
    {
      src: "http://allowed.example/y",
      resolvedUrl: "http://allowed.example/y",
      thirdParty: true,
      allowed: true,
    },
  ]);
  expect(root.varsInIncludeSrc).toBe(true);
  expect(root.usedVars).toEqual(["QUERY_STRING{a}"]);
  // no reports for the one that wasn't allowed
  expect(reports.length).toEqual(4);
});

test("REPORT 6: a report only covers the document's own body", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(
        `<esi:vars>$(QUERY_STRING{r})</esi:vars><esi:include src="/child" />`,
      ),
    "/child": () =>
      esiResponse(
        `<esi:vars>$(HTTP_COOKIE{c})</esi:vars><esi:choose><esi:when test="1 == 1">x</esi:when></esi:choose>`,
      ),
  });
  const res = await new esi({ ...config, fetcher }).parse(url("/root"));
  await res.text();
  const root = byPath("/root");
  const child = byPath("/child");
  expect(root.usedVars).toEqual(["QUERY_STRING{r}"]);
  expect(root.usedConditionals).toBe(false);
  expect(root.includes.length).toEqual(1);
  expect(child.usedVars).toEqual(["HTTP_COOKIE{c}"]);
  expect(child.usedConditionals).toBe(true);
  expect(child.includes).toEqual([]);
});

test("REPORT 7: recursionLimitHit", async () => {
  const fetcher = routeFetcher({
    "/loop": () => esiResponse(`x<esi:include src="/loop" />`),
  });
  const res = await new esi({ ...config, recursionLimit: 3, fetcher }).parse(
    url("/loop"),
  );
  expect(await res.text()).toEqual("xxx");
  // levels 0, 1 and 2 are fetched. Level 3 never is
  expect(reports.map((r) => r.recursion).sort()).toEqual([0, 1, 2]);
  expect(byPathAndLevel(2).recursionLimitHit).toBe(true);
  expect(byPathAndLevel(1).recursionLimitHit).toBe(false);
  expect(byPathAndLevel(0).recursionLimitHit).toBe(false);
});

const byPathAndLevel = (level: number): ESIDocumentReport => {
  const found = reports.filter((r) => r.recursion == level);
  expect(found.length).toEqual(1);
  return found[0];
};

test("REPORT 8: errors thrown by the hook (sync or async) do not affect the output", async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const fetcher = routeFetcher({
      "/root": () =>
        esiResponse(`A<esi:include src="/a" />B<esi:include src="/b" />C`),
      "/a": () => esiResponse(`a`),
      "/b": () => new Response("b"),
    });
    let calls = 0;
    const res = await new esi({
      ...config,
      onDocumentProcessed: (report) => {
        calls++;
        if (new URL(report.request.url).pathname == "/a") {
          throw new Error("sync");
        }
        return Promise.reject(new Error("async"));
      },
      fetcher,
    }).parse(url("/root"));
    expect(await res.text()).toEqual("AaBbC");
    expect(calls).toEqual(3);
  } finally {
    console.error = originalError;
  }
});

test("REPORT 9: an async hook is waited for before the body completes", async () => {
  let finished = false;
  const fetcher = routeFetcher({
    "/root": () => esiResponse(`A<esi:include src="/a" />`),
    "/a": () => esiResponse(`a`),
  });
  const res = await new esi({
    ...config,
    onDocumentProcessed: async () => {
      await sleep(20);
      finished = true;
    },
    fetcher,
  }).parse(url("/root"));
  await res.text();
  expect(finished).toBe(true);
});

test("REPORT 10: the hook is not needed. Same output without it", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      esiResponse(
        `<esi:vars>$(QUERY_STRING{a})</esi:vars><esi:include src="/a" />`,
      ),
    "/a": () => new Response("a"),
  });
  const without = await new esi({ contentTypes: ["text/html"], fetcher }).parse(
    url("/root?a=1"),
  );
  const withHook = await new esi({ ...config, fetcher }).parse(
    url("/root?a=1"),
  );
  expect(await withHook.text()).toEqual(await without.text());
});

test("REPORT 11: delegation to a surrogate means the document wasn't processed", async () => {
  const fetcher = routeFetcher({
    "/root": () =>
      new Response("<esi:include src='/a'/>", { headers: esiHead }),
  });
  const res = await new esi({
    ...config,
    allowSurrogateDelegation: true,
    fetcher,
  }).parse(
    new Request("http://localhost/root", {
      headers: { "Surrogate-Capability": `abc="ESI/1.0"` },
    }),
  );
  await res.text();
  expect(reports.length).toEqual(1);
  expect(reports[0].isESI).toBe(false);
});
