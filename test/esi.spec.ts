import { urlHandler, checkSurrogate, testResponse } from "./helpers";
import http from "http";
import { AddressInfo } from "net";
import { customESIVars, esi, ESIConfig } from "../src";

const esiHead = {
  "Content-Type": "text/html",
  "Surrogate-Control": `content="ESI/1.0"`,
};

let parser: esi;
let config: ESIConfig;
const makeRequest = async function (request: string, details?: RequestInit) {
  const reqUrl = new URL(request, `http://localhost:${port}`).toString();
  const req = new Request(reqUrl, details);
  return parser.parse(req);
};

const routeHandler = new urlHandler();
// @ts-ignore
const server = http.createServer(routeHandler.route);
let port = 0;
const testingDetails = {
  port: 0,
  hostname: "localhost",
  proto: "http:",
  url: `http://localhost:0`,
};

beforeAll(() => {
  // Setup a basic HTTP server to handle traffic
  server.listen(0);
  const address = server.address() as AddressInfo;
  port = address.port;
  testingDetails.port = address.port;
  testingDetails.url = `http://localhost:${port}`;
});

beforeEach(() => {
  config = {
    contentTypes: ["text/html", "text/plain"],
  };
  parser = new esi(config);
});

afterAll((done) => {
  server.close(() => {
    done();
  });
});

afterEach(async () => {
  expect(routeHandler.verify()).toBeTruthy();
  config = {
    contentTypes: ["text/html", "text/plain"],
  };
});

test("TEST 1: Single line comments removed", async () => {
  const url = `/esi/test-1`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.say("<!--esiCOMMENTED-->");
    res.end("<!--esiCOMMENTED-->");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual("COMMENTED\nCOMMENTED");
});

test("TEST 1b: Single line comments removed, esi instructions processed", async () => {
  const url = `/esi/test-1b?a=1b`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`<!--esi<esi:vars>$(QUERY_STRING)</esi:vars>-->`);
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual("a=1b");
});

test("TEST 2: Multi line comments removed", async () => {
  const url = `/esi/test-2`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.write("<!--esi");
    res.write("1");
    res.say("-->");
    res.say("2");
    res.say("<!--esi");
    res.say("3");
    res.end("-->");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual("1\n2\n\n3\n");
});

test("TEST 2b: Multi line comments removed, ESI instructions processed", async () => {
  const url = `/esi/test-2b`;
  routeHandler.add(`${url}?a=1`, function (req, res) {
    res.writeHead(200, esiHead);
    res.write("<!--esi");
    res.write(`1234 <esi:include src="${url}/test" />`);
    res.say("-->");
    res.say("2345");
    res.say("<!--esi");
    res.say("<esi:vars>$(QUERY_STRING)</esi:vars>");
    res.end("-->");
  });
  routeHandler.add(`${url}/test`, function (req, res) {
    res.writeHead(200, esiHead);
    res.end("OK");
  });
  const res = await makeRequest(`${url}?a=1`);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`1234 OK\n2345\n\na=1\n`);
});

test("TEST 2c: Multi line escaping comments, nested.", async () => {
  const url = `/esi/test-2c?a=1&b=2&c=3`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.say("BEFORE");
    res.write("<!--esi");
    res.say("<esi:vars>$(QUERY_STRING{a})</esi:vars>");
    res.write("<!--esi");
    res.say("<esi:vars>$(QUERY_STRING{b})</esi:vars>");
    res.write("-->");
    res.say("MIDDLE");
    res.say("<esi:vars>$(QUERY_STRING{c})</esi:vars>");
    res.write("-->");
    res.end("AFTER");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`BEFORE\n1\n2\nMIDDLE\n3\nAFTER`);
});

test("TEST 3: Single line <esi:remove> removed.", async () => {
  const url = `/esi/test-3`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.say("START");
    res.say("<esi:remove>REMOVED</esi:remove>");
    res.say("<esi:remove>REMOVED</esi:remove>");
    res.end("END");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`START\n\n\nEND`);
});

test("TEST 3b: Test comments are removed. Nested.", async () => {
  const url = `/esi/test-3b`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(
      'BEFORE <esi:choose><esi:when test="1>2" ></esi:when><esi:otherwise><esi:remove> FIRST </esi:remove><esi:remove> SECOND </esi:remove></esi:otherwise></esi:choose> AFTER'
    );
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual("BEFORE  AFTER");
});

test("TEST 4: Multi line <esi:remove> removed.", async () => {
  const url = `/esi/test-4`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.say("1");
    res.say("<esi:remove>");
    res.say("2");
    res.say("</esi:remove>");
    res.say("3");
    res.say("4");
    res.say("<esi:remove>");
    res.say("5");
    res.say("</esi:remove>");
    res.end("6");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`1\n\n3\n4\n\n6`);
});

test("TEST 5: Include fragment", async () => {
  const url = `/esi/test-5`;
  const printFragment = function (
    req: http.IncomingMessage,
    res: testResponse
  ) {
    const url = new URL(req.url as string, `http://localhost:${port}`);
    const query = url.searchParams.get("a") ? url.searchParams.get("a") : "";
    res.end(`FRAGMENT: ${query}\n`);
  };
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.say("1");
    res.write(`<esi:include src="${url}/fragment_1" />`);
    res.say("2");
    res.write(`<esi:include src="${url}/fragment_1?a=2" />`);
    res.write("3");
    res.end(
      `<esi:include src="http://localhost:${port}${url}/fragment_1?a=3" />`
    );
  });
  routeHandler.add(`${url}/fragment_1`, printFragment);
  routeHandler.add(`${url}/fragment_1?a=2`, printFragment);
  routeHandler.add(`${url}/fragment_1?a=3`, printFragment);
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `1\nFRAGMENT: \n2\nFRAGMENT: 2\n3FRAGMENT: 3\n`
  );
});

test("TEST 5b: Test fragment always issues GET and only inherits correct req headers", async () => {
  const url = `/esi/test-5b`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.say(`ORIGINAL METHOD: ${req.method}`);
    res.end(`<esi:include src="${url}/fragment_1" />`);
  });
  routeHandler.add(`${url}/fragment_1`, function (req, res) {
    res.writeHead(200, esiHead);
    res.say(`method: ${req.method}`);
    for (const [key, value] of Object.entries(req.headers)) {
      res.say(`${key}: ${value}`);
    }
    res.end();
  });
  const res = await makeRequest(url, {
    method: "POST",
    headers: {
      "Cache-Control": "no-cache",
      Cookie: "foo",
      Authorization: "bar",
      Range: "bytes=0-",
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  const text = await res.text();
  expect(text).toEqual(
    `ORIGINAL METHOD: POST\nmethod: GET\nhost: localhost:${port}\nconnection: keep-alive\naccept-encoding: gzip, deflate\nauthorization: bar\ncache-control: no-cache\ncookie: foo\nmf-loop: 1\nsurrogate-capability: cloudflareWorkerESI="ESI/1.0"\nx-esi-parent-uri: http://localhost:${port}/esi/test-5b\nx-esi-recursion-level: 1\n`
  );
});

test("TEST 5c: Include fragment with absolute URI, schemaless, and no path", async () => {
  const url = `/esi/test-5c`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.say(
      `<esi:include src="${testingDetails.proto}//${testingDetails.hostname}:${testingDetails.port}${url}/fragment_1" />`
    );
    res.say(
      `<esi:include src="//${testingDetails.hostname}:${testingDetails.port}${url}/fragment_1" />`
    );
    res.say(
      `<esi:include src="${testingDetails.proto}//${testingDetails.hostname}:${testingDetails.port}/" />`
    );
    res.say(
      `<esi:include src="${testingDetails.proto}//${testingDetails.hostname}:${testingDetails.port}" />`
    );
    res.end(
      `<esi:include src="//${testingDetails.hostname}:${testingDetails.port}" />`
    );
  });
  routeHandler.add(
    `/`,
    function (req, res) {
      res.end("ROOT FRAGMENT");
    },
    { count: 3 }
  );
  routeHandler.add(
    `${url}/fragment_1`,
    function (req, res) {
      res.end("FRAGMENT");
    },
    { count: 2 }
  );

  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `FRAGMENT\nFRAGMENT\nROOT FRAGMENT\nROOT FRAGMENT\nROOT FRAGMENT`
  );
});

test("TEST 6: Include multiple fragments, in correct order.", async () => {
  const url = `/esi/test-6`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.say(`<esi:include src="${url}/fragment_3" />`);
    res.say(`MID LINE <esi:include src="${url}/fragment_1" />`);
    res.say(`<esi:include src="${url}/fragment_2" />`);
    res.end();
  });
  routeHandler.add(`${url}/fragment_3`, function (req, res) {
    res.end("FRAGMENT_3");
  });
  routeHandler.add(`${url}/fragment_1`, function (req, res) {
    res.end("FRAGMENT_1");
  });
  routeHandler.add(`${url}/fragment_2`, function (req, res) {
    res.end("FRAGMENT_2");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `FRAGMENT_3\nMID LINE FRAGMENT_1\nFRAGMENT_2\n`
  );
});

// Ready just do not have this functionality yet
test("TEST 7b: Leave instructions intact if ESI delegation is enabled - slow path.", async () => {
  let url = `/esi/test-7b`;
  // set surrogate up
  config.allowSurrogateDelegation = true;
  parser = new esi(config);
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`<esi:vars>$(QUERY_STRING)</esi:vars>`);
  });
  let res = await makeRequest(url, {
    headers: { "Surrogate-Capability": `localhost="ESI/1.0"` },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeFalsy();
  expect(await res.text()).toEqual(`<esi:vars>$(QUERY_STRING)</esi:vars>`);
});

test.todo(
  "TEST 7c: Leave instructions intact if ESI delegation is enabled - fast path"
);

test("TEST 7d: Leave instructions intact if ESI delegation is enabled by IP on the slow path.", async () => {
  let url = `/esi/test-7d`;
  config.allowSurrogateDelegation = ["127.0.0.1"];
  parser = new esi(config);
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`<esi:vars>$(QUERY_STRING)</esi:vars>`);
  });
  let res = await makeRequest(url, {
    headers: {
      "Surrogate-Capability": `localhost="ESI/1.0"`,
      "CF-Connecting-IP": "127.0.0.1",
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeFalsy();
  expect(await res.text()).toEqual(`<esi:vars>$(QUERY_STRING)</esi:vars>`);
});

test.todo(
  "TEST 7e: Leave instructions intact if ESI delegation is enabled by IP on the fast path."
);

test("TEST 7f: Leave instructions intact if allowed types does not match on the slow path.", async () => {
  const url = `/esi/test-7f`;
  config.contentTypes = ["invalid/type"];
  parser = new esi(config);
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`<esi:vars>$(QUERY_STRING)</esi:vars>`);
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeFalsy();
  expect(await res.text()).toEqual(`<esi:vars>$(QUERY_STRING)</esi:vars>`);
});

test.todo(
  "TEST 7g: Leave instructions intact if allowed types does not match (fast path)"
);

test("TEST 7h: Compile instructions if ESI delegation is enabled by IP but no Capability header sent.", async () => {
  let url = `/esi/test-7h?a=1`;
  config.allowSurrogateDelegation = ["127.0.0.1"];
  parser = new esi(config);
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`<esi:vars>$(QUERY_STRING)</esi:vars>`);
  });
  let res = await makeRequest(url, {
    headers: { "CF-Connecting-IP": "127.0.0.1" },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`a=1`);
});

test("TEST 8: Response downstrean cacheability is zeroed when ESI processing", async () => {
  const url = `/esi/test-8`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Surrogate-Control": `content="ESI/1.0"`,
      "Cache-Control": "max-age=120",
    });
    res.end(`<esi:include src="${url}/fragment_1" />`);
  });
  routeHandler.add(`${url}/fragment_1`, function (req, res) {
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Surrogate-Control": `content="ESI/1.0"`,
      "Cache-Control": "max-age=60",
    });
    res.end("FRAGMENT_1");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(res.headers.get("Cache-Control")).toEqual("private, max-age=0");
  expect(await res.text()).toEqual("FRAGMENT_1");
});

// Note this test isn't entirely 1-1 as the Ledge repo
// Because of https://github.com/nodejs/node/issues/3591
test("TEST 9: Variable evaluation", async () => {
  const url = `/esi/test-9?t=1`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.say("HTTP_COOKIE: <esi:vars>$(HTTP_COOKIE)</esi:vars>");
    res.say(
      "HTTP_COOKIE{SQ_SYSTEM_SESSION}: <esi:vars>$(HTTP_COOKIE{SQ_SYSTEM_SESSION})</esi:vars>"
    );
    res.say("<esi:vars>");
    res.say("HTTP_COOKIE: $(HTTP_COOKIE)");
    res.say(
      "HTTP_COOKIE{SQ_SYSTEM_SESSION}: $(HTTP_COOKIE{SQ_SYSTEM_SESSION})"
    );
    res.say(
      "HTTP_COOKIE{SQ_SYSTEM_SESSION_TYPO}: $(HTTP_COOKIE{SQ_SYSTEM_SESSION_TYPO}|'default message')"
    );
    res.say("</esi:vars>");
    res.say(
      "<esi:vars>$(HTTP_COOKIE{SQ_SYSTEM_SESSION})</esi:vars>$(HTTP_COOKIE)<esi:vars>$(QUERY_STRING)</esi:vars>"
    );
    res.say(
      "$(HTTP_X_MANY_HEADERS): <esi:vars>$(HTTP_X_MANY_HEADERS)</esi:vars>"
    );
    res.end(
      "$(HTTP_X_MANY_HEADERS{2}): <esi:vars>$(HTTP_X_MANY_HEADERS{2})</esi:vars>"
    );
  });

  const res = await makeRequest(url, {
    headers: {
      Cookie: "myvar=foo; SQ_SYSTEM_SESSION=hello",
      "X-Many-Headers": "1, 2, 3, 4, 5, 6=hello",
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `HTTP_COOKIE: myvar=foo; SQ_SYSTEM_SESSION=hello\nHTTP_COOKIE{SQ_SYSTEM_SESSION}: hello\n\nHTTP_COOKIE: myvar=foo; SQ_SYSTEM_SESSION=hello\nHTTP_COOKIE{SQ_SYSTEM_SESSION}: hello\nHTTP_COOKIE{SQ_SYSTEM_SESSION_TYPO}: default message\n\nhello$(HTTP_COOKIE)t=1\n$(HTTP_X_MANY_HEADERS): 1, 2, 3, 4, 5, 6=hello\n$(HTTP_X_MANY_HEADERS{2}): 1, 2, 3, 4, 5, 6=hello`
  );
});

test("TEST 9b: Multiple Variable evaluation", async () => {
  const url = `/esi/test-9b`;
  routeHandler.add(`${url}?t=1`, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(
      `<esi:include src="${url}/fragment_1b?$(QUERY_STRING)&test=$(HTTP_X_ESI_TEST)" /> <a href="$(QUERY_STRING)" />`
    );
  });
  routeHandler.add(`${url}/fragment_1b?t=1&test=foobar`, function (req, res) {
    const url = new URL(req.url as string, testingDetails.url);
    res.writeHead(200, esiHead);
    res.end(`FRAGMENT: ${url.search}`);
  });

  const res = await makeRequest(`${url}?t=1`, {
    headers: {
      "X-ESI-Test": "foobar",
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `FRAGMENT: ?t=1&test=foobar <a href="$(QUERY_STRING)" />`
  );
});

test("TEST 9c: Dictionary variable syntax (cookie)", async () => {
  const url = `/esi/test-9c`;
  routeHandler.add(`${url}?t=1`, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(
      `<esi:include src="${url}/fragment1c?$(QUERY_STRING{t})&test=$(HTTP_COOKIE{foo})" />`
    );
  });
  routeHandler.add(`${url}/fragment1c?1&test=bar`, function (req, res) {
    const url = new URL(req.url as string, testingDetails.url);
    res.writeHead(200, esiHead);
    res.end(`FRAGMENT: ${url.search}`);
  });

  const res = await makeRequest(`${url}?t=1`, {
    headers: {
      Cookie: "foo=bar",
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`FRAGMENT: ?1&test=bar`);
});

test("TEST 9d: List variable syntax (accept-language)", async () => {
  const url = `/esi/test-9d`;
  routeHandler.add(`${url}?t=1`, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(
      `<esi:include src="${url}/fragment1d?$(QUERY_STRING{t})&en-gb=$(HTTP_ACCEPT_LANGUAGE{en-gb})&de=$(HTTP_ACCEPT_LANGUAGE{de})" />`
    );
  });
  routeHandler.add(
    `${url}/fragment1d?1&en-gb=true&de=false`,
    function (req, res) {
      const url = new URL(req.url as string, testingDetails.url);
      res.writeHead(200, esiHead);
      res.end(`FRAGMENT: ${url.search}`);
    }
  );

  const res = await makeRequest(`${url}?t=1`, {
    headers: {
      "Accept-Language": "da, en-gb, fr",
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`FRAGMENT: ?1&en-gb=true&de=false`);
});

test("TEST 9e: List variable syntax (accept-language) with multiple headers", async () => {
  const url = `/esi/test-9e`;
  routeHandler.add(`${url}?t=1`, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(
      `<esi:include src="${url}/fragment1d?$(QUERY_STRING{t})&en-gb=$(HTTP_ACCEPT_LANGUAGE{en-gb})&de=$(HTTP_ACCEPT_LANGUAGE{de})" />`
    );
  });
  routeHandler.add(
    `${url}/fragment1d?1&en-gb=true&de=false`,
    function (req, res) {
      const url = new URL(req.url as string, testingDetails.url);
      res.writeHead(200, esiHead);
      res.end(`FRAGMENT: ${url.search}`);
    }
  );

  const res = await makeRequest(`${url}?t=1`, {
    // @ts-ignore
    headers: {
      "Accept-Language": ["da, en-gb", "fr"],
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`FRAGMENT: ?1&en-gb=true&de=false`);
});

test("TEST 9f: Default variable values", async () => {
  const url = `/esi/test-9f?a=1`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.write("<esi:vars>");
    res.say("$(QUERY_STRING{a}|novalue)");
    res.say("$(QUERY_STRING{b}|novalue)");
    res.say("$(QUERY_STRING{c}|'quoted values can have spaces')");
    res.say("$(QUERY_STRING{d}|unquoted values must not have spaces)");
    res.say("$(HTTP_HEADER_DOESNT_EXIST|default_header)");
    res.say("$(WHAT_AM_I|default_var)");
    res.say("$(HTTP_COOKIE{d}|default)");
    res.end("</esi:vars>");
  });

  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `1\nnovalue\nquoted values can have spaces\n$(QUERY_STRING{d}|unquoted values must not have spaces)\ndefault_header\ndefault_var\ndefault\n`
  );
});

test("TEST 9g: Default variable values no query string", async () => {
  const url = `/esi/test-9g`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.write("<esi:vars>");
    res.say("$(QUERY_STRING|novalue)");
    res.end("</esi:vars>");
  });

  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`novalue\n`);
});

test("TEST 9h: Custom variable injection", async () => {
  let url = `/esi/test-9h`;
  // set custom varibles up
  const customVaribles = async function (
    request: Request
  ): Promise<customESIVars> {
    return {
      CUSTOM_DICTIONARY: {
        a: "1",
        b: "2",
      },
      CUSTOM_STRING: "foo",
    };
  };
  parser = new esi(config, customVaribles);
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.write("<esi:vars>");
    res.say("$(CUSTOM_DICTIONARY|novalue)");
    res.say("$(CUSTOM_DICTIONARY{a})");
    res.say("$(CUSTOM_DICTIONARY{b})");
    res.say("$(CUSTOM_DICTIONARY{c}|novalue)");
    res.say("$(CUSTOM_STRING)");
    res.say("$(CUSTOM_STRING{x}|novalue)");
    res.end("</esi:vars>");
  });
  let res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`novalue
1
2
novalue
foo
novalue
`);
});

test("TEST 9i: Custom variable injection in fragment", async () => {
  let url = `/esi/test-9i`;
  // set custom varibles up
  const customVaribles = async function (
    request: Request
  ): Promise<customESIVars> {
    return {
      CUSTOM_DICTIONARY: {
        a: "1",
        b: "2",
      },
      CUSTOM_STRING: "foo",
    };
  };
  parser = new esi(config, customVaribles);
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`<esi:include src="${url}/fragment_1" />`);
  });
  routeHandler.add(`${url}/fragment_1`, function (req, res) {
    res.writeHead(200, esiHead);
    res.write("<esi:vars>");
    res.say("$(CUSTOM_DICTIONARY|novalue)");
    res.say("$(CUSTOM_DICTIONARY{a})");
    res.say("$(CUSTOM_DICTIONARY{b})");
    res.say("$(CUSTOM_DICTIONARY{c}|novalue)");
    res.say("$(CUSTOM_STRING)");
    res.say("$(CUSTOM_STRING{x}|novalue)");
    res.end("</esi:vars>");
  });
  let res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`novalue
1
2
novalue
foo
novalue
`);
});

test.todo("TEST 10: Prime ESI in cache");
test.todo("TEST 10b: ESI still runs on cache HIT.");
test.todo("TEST 10c: ESI still runs on cache revalidation, upstream 200.");
test.todo(
  "TEST 10d: ESI still runs on cache revalidation, upstream 200, locally valid."
);
test.todo(
  "TEST 10e: ESI still runs on cache revalidation, upstream 304, locally valid."
);
test.todo("TEST 11: Prime fragment");
test.todo("TEST 11b: Include fragment with client validators.");

test('TEST 11c: Include fragment with " H" in URI', async () => {
  const url = `/esi/test-11c`;
  routeHandler.add(`${url}`, function (req, res) {
    res.writeHead(200, esiHead);
    res.say("1");
    res.write(`<esi:include src="${url}/frag Hment" />`);
    res.end("2");
  });
  routeHandler.add(`${url}/frag%20Hment`, function (req, res) {
    res.writeHead(200, esiHead);
    res.end("FRAGMENT\n");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`1\nFRAGMENT\n2`);
});

test.todo("TEST 11d: Use callback feature to modify fragment request params");

test.todo("TEST 12: ESI processed over buffer larger than buffer_size.");
test.todo(
  "TEST 12b: Incomplete ESI tag opening at the end of buffer (lookahead)"
);
test.todo(
  "TEST 12c: Incomplete ESI tag opening at the end of buffer (lookahead)"
);
test.todo(
  "TEST 12d: Incomplete ESI tag opening at the end of buffer (lookahead)"
);

test("TEST 12e: Incomplete ESI tag opening at the end of response (regression)", async () => {
  const url = `/esi/test-12e?a=1`;
  routeHandler.add(`${url}`, function (req, res) {
    res.writeHead(200, esiHead);
    res.write(`---<esi:vars>`);
    res.write(`$(QUERY_STRING)`);
    res.end("</esi:vars><es");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`---a=1<es`);
});

test.todo("TEST 13: ESI processed over buffer larger than max_memory.");

test("TEST 14: choose - when - otherwise, first when matched", async () => {
  const content = `Hello
<esi:choose>
<esi:when test="$(QUERY_STRING{a}) == 1">
True
</esi:when>
<esi:when test="2 == 2">
Still true, but first match wins
</esi:when>
<esi:otherwise>
Will never happen
</esi:otherwise>
</esi:choose>
Goodbye`;
  const url = `/esi/test-14?a=1`;
  routeHandler.add(`${url}`, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(content);
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`Hello\n\nTrue\n\nGoodbye`);
});

test("TEST 15: choose - when - otherwise, second when matched", async () => {
  const content = `Hello
<esi:choose>
<esi:when test="$(QUERY_STRING{a}) == 1">
1
</esi:when>
<esi:when test="$(QUERY_STRING{a}) == 2">
2
</esi:when>
<esi:when test="2 == 2">
Still true, but second match wins
</esi:when>
<esi:otherwise>
Will never happen
</esi:otherwise>
</esi:choose>
Goodbye`;
  const url = `/esi/test-15?a=2`;
  routeHandler.add(`${url}`, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(content);
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`Hello\n\n2\n\nGoodbye`);
});

test("TEST 16: choose - when - otherwise, otherwise catchall", async () => {
  const content = `Hello
<esi:choose>
<esi:when test="$(QUERY_STRING{a}) == 1">
1
</esi:when>
<esi:when test="$(QUERY_STRING{a}) == 2">
2
</esi:when>
<esi:otherwise>
Otherwise
</esi:otherwise>
</esi:choose>
Goodbye`;
  const url = `/esi/test-16?a=3`;
  routeHandler.add(`${url}`, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(content);
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`Hello\n\nOtherwise\n\nGoodbye`);
});

test("TEST 16b: multiple single line choose - when - otherwise", async () => {
  const content = `<esi:choose><esi:when test="$(QUERY_STRING{a}) == 1">1</esi:when><esi:otherwise>Otherwise</esi:otherwise></esi:choose>: <esi:choose><esi:when test="$(QUERY_STRING{a}) == 3">3</esi:when><esi:otherwise>NOPE</esi:otherwise></esi:choose>`;
  const url = `/esi/test-16b?a=3`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(content);
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`Otherwise: 3`);
});

test("TEST 16c: first when wins", async () => {
  const content = `BEFORE<esi:choose><esi:when test="$(QUERY_STRING{a}) == 1">first</esi:when><esi:when test="$(QUERY_STRING{a}) == 1">second</esi:when></esi:choose>AFTER`;
  const url = `/esi/test-16c?a=1`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(content);
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`BEFOREfirstAFTER`);
});

test("TEST 17: choose - when - test, conditional syntax", async () => {
  const conditions = [
    "1 == 1",
    "1==1",
    "1 != 2",
    "2 > 1",
    "1 > 2 | 3 > 2",
    "(1 > 2) | (3.02 > 2.4124 & 1 <= 1)",
    "(1>2)||(3>2&&2>1)",
    "! (1 < 2) | (3 > 2 & 2 >= 1)",
    "'hello' == 'hello'",
    "'hello' != 'goodbye'",
    "'repeat' != 'function'", // use of lua words in strings
    "'repeat' != function", // use of lua words unquoted
    "'exit()' == exit()", // use of lua words unquoted
    "'process.exit()' == process.exit()", // use of lua words unquoted
    "''(function(){process.exit()})()' == (function(){process.exit()})()", // use of lua words unquoted
    "'(function(){console.log(`fdasfdsaf`)})()' == exit()", // use of lua words unquoted
    "' repeat sentence with function in it ' == ' repeat sentence with function in it '", // use of lua words in strings
    "$(QUERY_STRING{msg}) == 'hello'",
    `'string \\' escaping' == 'string \\' escaping'`,
    `'string \\" escaping' == 'string \\" escaping'`,
    `$(QUERY_STRING{msg2}) == 'hel\\'lo'`,
    "'hello' =~ '/llo/'",
    `'HeL\\'\\'\\'Lo' =~ '/hel[\\']{1,3}lo/i'`,
    // eslint-disable-next-line no-useless-escape
    `'http://example.com?foo=bar' =~ '/^(http[s]?)://([^:/]+)(?::(\d+))?(.*)/'`,
    // eslint-disable-next-line no-useless-escape
    `'htxtp://example.com?foo=bar' =~ '/^(http[s]?)://([^:/]+)(?::(\d+))?(.*)/'`,
    "(1 > 2) | (3.02 > 2.4124 & 1 <= 1) && ('HeLLo' =~ '/hello/i')",
    "2 =~ '/[0-9]/'",
    // Should be a failed regex
    "2 =~ ''",
    "2 =~ '.'",
    "2 ==",
    "2 =~ =~",
    "$(HTTP_ACCEPT_LANGUAGE{gb}) == 'true'",
    "$(HTTP_ACCEPT_LANGUAGE{fr}) == 'false'",
    "$(HTTP_ACCEPT_LANGUAGE{fr}) == 'true'",
    "!(1>2) | 1 > 2",
    "1 > 2 && 2 == 2",
    "2 == 2",
    "(1==1) && (1==2) || (1==1)",
    `((1==1) && (1==1) || (1==2)) && ((1==1) || ((1==2) && (1==1)))`,
    `(((1==1) && (1==1)) || (1==2) && !(1==1))`,
    `((1==1) && !(1==2)) && (1==1) && !(1==2)`,
    `1 =~ 2`,
  ];
  const url = `/esi/test-17?msg=hello&msg2=hel'lo`;
  routeHandler.add(`/esi/test-17?msg=hello&msg2=hel%27lo`, function (req, res) {
    res.writeHead(200, esiHead);
    for (const [, c] of conditions.entries())
      res.say(
        `<esi:choose><esi:when test="${c}">${c}</esi:when><esi:otherwise>Failed</esi:otherwise></esi:choose>`
      );
    res.end();
  });
  const res = await makeRequest(url, {
    headers: {
      "Accept-Language": "en-gb",
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`1 == 1
1==1
1 != 2
2 > 1
1 > 2 | 3 > 2
(1 > 2) | (3.02 > 2.4124 & 1 <= 1)
(1>2)||(3>2&&2>1)
! (1 < 2) | (3 > 2 & 2 >= 1)
'hello' == 'hello'
'hello' != 'goodbye'
'repeat' != 'function'
Failed
Failed
Failed
Failed
Failed
' repeat sentence with function in it ' == ' repeat sentence with function in it '
hello == 'hello'
'string \\' escaping' == 'string \\' escaping'
'string \\" escaping' == 'string \\" escaping'
hel'lo == 'hel\\'lo'
'hello' =~ '/llo/'
'HeL\\'\\'\\'Lo' =~ '/hel[\\']{1,3}lo/i'
'http://example.com?foo=bar' =~ '/^(http[s]?)://([^:/]+)(?::(\d+))?(.*)/'
Failed
(1 > 2) | (3.02 > 2.4124 & 1 <= 1) && ('HeLLo' =~ '/hello/i')
2 =~ '/[0-9]/'
Failed
Failed
Failed
Failed
true == 'true'
false == 'false'
Failed
!(1>2) | 1 > 2
Failed
2 == 2
(1==1) && (1==2) || (1==1)
((1==1) && (1==1) || (1==2)) && ((1==1) || ((1==2) && (1==1)))
(((1==1) && (1==1)) || (1==2) && !(1==1))
((1==1) && !(1==2)) && (1==1) && !(1==2)
Failed
`);
});

// TODO grab the console.log by overwriting the function here
test("17b: Lexer complains about unparseable conditions", async () => {
  const content = `<esi:choose>
<esi:when test="'hello' 'there'">OK</esi:when>
<esi:when test="3 'hello'">OK</esi:when>
<esi:when test="'hello' 4">OK</esi:when>
<esi:otherwise>Otherwise</esi:otherwise>
</esi:choose>
`;
  const url = `/esi/test-17b`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(content);
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`Otherwise\n`);
});

test("TEST 18: Surrogate-Control with lower version number still works.", async () => {
  const url = `/esi/test-18?a=1`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Surrogate-Control": `content="ESI/0.8"`,
    });
    res.end("<esi:vars>$(QUERY_STRING)</esi:vars>");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`a=1`);
});

test("TEST 19: Surrogate-Control with higher version fails.", async () => {
  const url = `/esi/test-19`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Surrogate-Control": `content="ESI/1.1"`,
    });
    res.end("<esi:vars>$(QUERY_STRING)</esi:vars>");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeFalsy();
  expect(await res.text()).toEqual(`<esi:vars>$(QUERY_STRING)</esi:vars>`);
});

test("TEST 19b: No Surrogate-Control leaves instructions.", async () => {
  const url = `/esi/test-19b`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, {
      "Content-Type": "text/html",
    });
    res.end("<esi:vars>$(QUERY_STRING)</esi:vars>");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`<esi:vars>$(QUERY_STRING)</esi:vars>`);
});

test("TEST 20: Test we advertise Surrogate-Capability (without COLO Data)", async () => {
  const url = `/esi/test-20`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(req.headers["surrogate-capability"]);
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toMatch(/^(.*)="ESI\/1.0"$/);
});

test("TEST 20b: Test we advertise Surrogate-Capability (with COLO Data)", async () => {
  const url = `/esi/test-20`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(req.headers["surrogate-capability"]);
  });
  // @ts-expect-error Not going to fill out a whole Cloudflare object here
  const res = await makeRequest(url, { cf: { colo: "DFW" } });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toMatch(/^(.*)DFW="ESI\/1.0"$/);
});

test("TEST 21: Test Surrogate-Capability is appended when needed", async () => {
  const url = `/esi/test-20`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(req.headers["surrogate-capability"]);
  });
  const res = await makeRequest(url, {
    headers: { "Surrogate-Capability": `abc="ESI/0.8"` },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toMatch(/^abc="ESI\/0.8", (.*)="ESI\/1.0"$/);
});

test("TEST 22: Test comments are removed.", async () => {
  const url = `/esi/test-22?a=1`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(
      `1234<esi:comment text="comment text" /> 5678<esi:comment text="comment text 2" />`
    );
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`1234 5678`);
});

test("TEST 22b: Test comments are removed. Nested.", async () => {
  const url = `/esi/test-22b`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(
      'BEFORE <esi:choose><esi:when test="1>2"></esi:when><esi:otherwise><esi:comment test="hello test text" /> <esi:comment test="hello test text" /> <esi:comment test="hello test text" /> </esi:otherwise></esi:choose> AFTER'
    );
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`BEFORE     AFTER`);
});

test("TEST 23: Surrogate-Control removed when ESI enabled but no work needed (slow path)", async () => {
  const url = `/esi/test-23`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`NO ESI`);
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`NO ESI`);
});

test.todo(
  "TEST 23b: Surrogate-Control removed when ESI enabled but no work needed (fast path)"
);

// TODO add error log here
test("TEST 24: Fragment recursion limit", async () => {
  const url = `/esi/test-24`;
  routeHandler.add(
    url,
    function (req, res) {
      res.writeHead(200, esiHead);
      res.say(`p: ${req.headers["x-esi-recursion-level"] || 0}`);
      res.end(`<esi:include src="${url}/fragment_24" />`);
    },
    { count: 5 }
  );
  routeHandler.add(
    `${url}/fragment_24`,
    function (req, res) {
      res.writeHead(200, esiHead);
      res.say(`c: ${req.headers["x-esi-recursion-level"] || 0}`);
      res.end(`<esi:include src="${url}" />`);
    },
    { count: 5 }
  );
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `p: 0\nc: 1\np: 2\nc: 3\np: 4\nc: 5\np: 6\nc: 7\np: 8\nc: 9\n`
  );
});

// TODO add error log here
test("TEST 24b: Lower fragment recursion limit", async () => {
  const url = `/esi/test-24b`;
  config.recursionLimit = 5;
  parser = new esi(config);
  routeHandler.add(
    url,
    function (req, res) {
      res.writeHead(200, esiHead);
      res.say(`p: ${req.headers["x-esi-recursion-level"] || 0}`);
      res.end(`<esi:include src="${url}/fragment_24b" />`);
    },
    { count: 3 }
  );
  routeHandler.add(
    `${url}/fragment_24b`,
    function (req, res) {
      res.writeHead(200, esiHead);
      res.say(`c: ${req.headers["x-esi-recursion-level"] || 0}`);
      res.end(`<esi:include src="${url}" />`);
    },
    { count: 2 }
  );
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`p: 0\nc: 1\np: 2\nc: 3\np: 4\n`);
});

test("TEST 25: Multiple esi includes on a single line", async () => {
  const url = `/esi/test-25`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(
      `<esi:include src="${url}/fragment_25a" /> <esi:include src="${url}/fragment_25b" />`
    );
  });
  routeHandler.add(`${url}/fragment_25a`, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`25a`);
  });
  routeHandler.add(`${url}/fragment_25b`, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`25b`);
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`25a 25b`);
});

test("TEST 26: Include tag whitespace", async () => {
  const url = `/esi/test-26`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.say("1");
    res.say(`<esi:include src="${url}/fragment_1" />`);
    res.say(`2`);
    res.end(`<esi:include          src="${url}/fragment_1"        />`);
  });
  routeHandler.add(
    `${url}/fragment_1`,
    function (req, res) {
      res.writeHead(200, esiHead);
      res.end(`FRAGMENT`);
    },
    { count: 2 }
  );
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`1\nFRAGMENT\n2\nFRAGMENT`);
});

test.todo("TEST 27a: Prime cache, immediately expired");
test.todo("TEST 27b: ESI still works when serving stale");
test.todo("TEST 27c: ESI still works when serving stale-if-error");

test("TEST 28: Remaining parent response returned on fragment error", async () => {
  const url = `/esi/test-28`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.say(`1`);
    res.write(`<esi:include src="${url}/fragment_1" />`);
    res.end(`2`);
  });
  routeHandler.add(`${url}/fragment_1`, function (req, res) {
    res.writeHead(500, esiHead);
    res.end();
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`1\n2`);
});

test("TEST 29: Remaining parent response chunks returned on fragment error", async () => {
  const url = `/esi/test-29`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    const junk = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    res.say(junk);
    res.say(`1`);
    res.write(`<esi:include src="${url}/fragment_1" />`);
    res.say(junk);
    res.end(`2`);
  });
  routeHandler.add(`${url}/fragment_1`, function (req, res) {
    res.writeHead(500, esiHead);
    res.end();
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n1\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n2`
  );
});

test.todo(
  "TEST 30: Prime with ESI args - which should not enter cache key or reach the origin"
);
test.todo("TEST 30b: ESI args vary, but cache is a HIT");
test.todo("TEST 30c: As 30 but with request not accepting cache");

describe("TEST 31: Multiple sibling and child conditionals, winning expressions at various depths", () => {
  const content = `BEFORE CONTENT
<esi:choose>
    <esi:when test="$(QUERY_STRING{a}) == 'a'">a</esi:when>
</esi:choose>
<esi:choose>
    <esi:when test="$(QUERY_STRING{b}) == 'b'">b</esi:when>
    RANDOM ILLEGAL CONTENT
    <esi:when test="$(QUERY_STRING{c}) == 'c'">c
        <esi:choose>
            </esi:vars alt="BAD ILLEGAL NESTING">
            <esi:when test="$(QUERY_STRING{l1d}) == 'l1d'">l1d</esi:when>
            <esi:when test="$(QUERY_STRING{l1e}) == 'l1e'">l1e
                <esi:choose>
                    <esi:when test="$(QUERY_STRING{l2f}) == 'l2f'">l2f</esi:when>
                    <esi:otherwise>l2 OTHERWISE</esi:otherwise>
                </esi:choose>
            </esi:when>
            <esi:otherwise>l1 OTHERWISE
                <esi:choose>
                    <esi:when test="$(QUERY_STRING{l2g}) == 'l2g'">l2g</esi:when>
                    </esi:when alt="MORE BAD ILLEGAL NESTING">
                </esi:choose>
            </esi:otherwise>
        </esi:choose>
    </esi:when>
</esi:choose>
AFTER CONTENT`;
  const url = `/esi/test-31`;
  const tests = [
    { url: `${url}?a=a`, responseString: `BEFORE CONTENT\na\n\nAFTER CONTENT` },
    { url: `${url}?b=b`, responseString: `BEFORE CONTENT\n\nb\nAFTER CONTENT` },
    {
      url: `${url}?a=a&b=b`,
      responseString: `BEFORE CONTENT\na\nb\nAFTER CONTENT`,
    },
    {
      url: `${url}?l1d=l1d`,
      responseString: `BEFORE CONTENT\n\n\nAFTER CONTENT`,
    },
    {
      url: `${url}?c=c&l1d=l1d`,
      responseString: `BEFORE CONTENT\n\nc\n        l1d\n    \nAFTER CONTENT`,
    },
    {
      url: `${url}?c=c&l1e=l1e&l2f=l2f`,
      responseString: `BEFORE CONTENT\n\nc\n        l1e\n                l2f\n            \n    \nAFTER CONTENT`,
    },
    {
      url: `${url}?c=c&l1e=l1e`,
      responseString: `BEFORE CONTENT\n\nc\n        l1e\n                l2 OTHERWISE\n            \n    \nAFTER CONTENT`,
    },
    {
      url: `${url}?c=c`,
      responseString: `BEFORE CONTENT\n\nc\n        l1 OTHERWISE\n                \n            \n    \nAFTER CONTENT`,
    },
    {
      url: `${url}?c=c&l2g=l2g`,
      responseString: `BEFORE CONTENT\n\nc\n        l1 OTHERWISE\n                l2g\n            \n    \nAFTER CONTENT`,
    },
  ];

  const check = function (test: { url: string; responseString: string }) {
    return async () => {
      routeHandler.add(`${test.url}`, function (req, res) {
        res.writeHead(200, esiHead);
        res.end(content);
      });
      const res = await makeRequest(test.url);
      expect(res.ok).toBeTruthy();
      expect(checkSurrogate(res)).toBeTruthy();
      expect(await res.text()).toEqual(test.responseString);
    };
  };
  tests.forEach(function (details) {
    test(`GET ${details.url}`, check(details));
  });
});

describe("TEST 31b: As above, no whitespace", () => {
  const content = `BEFORE CONTENT<esi:choose><esi:when test="$(QUERY_STRING{a}) == 'a'">a</esi:when></esi:choose><esi:choose><esi:when test="$(QUERY_STRING{b}) == 'b'">b</esi:when>RANDOM ILLEGAL CONTENT<esi:when test="$(QUERY_STRING{c}) == 'c'">c<esi:choose><esi:when test="$(QUERY_STRING{l1d}) == 'l1d'">l1d</esi:when><esi:when test="$(QUERY_STRING{l1e}) == 'l1e'">l1e<esi:choose><esi:when test="$(QUERY_STRING{l2f}) == 'l2f'">l2f</esi:when><esi:otherwise>l2 OTHERWISE</esi:otherwise></esi:choose></esi:when><esi:otherwise>l1 OTHERWISE<esi:choose><esi:when test="$(QUERY_STRING{l2g}) == 'l2g'">l2g</esi:when></esi:choose></esi:otherwise></esi:choose></esi:when></esi:choose>AFTER CONTENT`;
  const url = `/esi/test-31b`;
  const tests = [
    { url: `${url}?a=a`, responseString: `BEFORE CONTENTaAFTER CONTENT` },
    { url: `${url}?b=b`, responseString: `BEFORE CONTENTbAFTER CONTENT` },
    { url: `${url}?a=a&b=b`, responseString: `BEFORE CONTENTabAFTER CONTENT` },
    { url: `${url}?l1d=l1d`, responseString: `BEFORE CONTENTAFTER CONTENT` },
    {
      url: `${url}?c=c&l1d=l1d`,
      responseString: `BEFORE CONTENTcl1dAFTER CONTENT`,
    },
    {
      url: `${url}?c=c&l1e=l1e&l2f=l2f`,
      responseString: `BEFORE CONTENTcl1el2fAFTER CONTENT`,
    },
    {
      url: `${url}?c=c&l1e=l1e`,
      responseString: `BEFORE CONTENTcl1el2 OTHERWISEAFTER CONTENT`,
    },
    {
      url: `${url}?c=c`,
      responseString: `BEFORE CONTENTcl1 OTHERWISEAFTER CONTENT`,
    },
    {
      url: `${url}?c=c&l2g=l2g`,
      responseString: `BEFORE CONTENTcl1 OTHERWISEl2gAFTER CONTENT`,
    },
  ];

  const check = function (test: { url: string; responseString: string }) {
    return async () => {
      routeHandler.add(`${test.url}`, function (req, res) {
        res.writeHead(200, esiHead);
        res.end(content);
      });
      const res = await makeRequest(test.url);
      expect(res.ok).toBeTruthy();
      expect(checkSurrogate(res)).toBeTruthy();
      expect(await res.text()).toEqual(test.responseString);
    };
  };
  tests.forEach(function (details) {
    test(`GET ${details.url}`, check(details));
  });
});

// confirm this test
test("TEST 32: Tag parsing boundaries", async () => {
  const url = `/esi/test-32?a=a`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(
      `BEFORE CONTENT\n<esi:choose\n><esi:when           \n                    test="$(QUERY_STRING{a}) == 'a'"\n            >a\n<esi:include \n                src="${url}/fragment_1"         \n/></esi:when\n>\n</esi:choose\n>\nAFTER CONTENT\n`
    );
  });
  routeHandler.add(`${url}/fragment_1`, function (req, res) {
    res.writeHead(200, esiHead);
    res.end("OK");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`BEFORE CONTENT\na\nOK\nAFTER CONTENT\n`);
});

test("TEST 33: Invalid Surrogate-Capability header is ignored", async () => {
  const url = `/esi/test-33?foo=bar`;
  config.allowSurrogateDelegation = true;
  parser = new esi(config);
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`<esi:vars>$(QUERY_STRING)</esi:vars>`);
  });
  const res = await makeRequest(url, {
    headers: {
      "Surrogate-Capability": `localhost=ESI/1foo`,
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`foo=bar`);
});

test("TEST 34: Leave instructions intact if surrogate-capability does not match http host", async () => {
  const url = `/esi/test-34?a=1`;
  config.allowSurrogateDelegation = true;
  parser = new esi(config);
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`<esi:vars>$(QUERY_STRING)</esi:vars>`);
  });
  const res = await makeRequest(url, {
    headers: {
      "Surrogate-Capability": `esi.example.com="ESI/1.0"`,
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeFalsy();
  expect(await res.text()).toEqual(`<esi:vars>$(QUERY_STRING)</esi:vars>`);
});

// confirm this one
test("TEST 35: ESI_ARGS instruction with no args in query string reach the origin", async () => {
  const url = `/esi/test-35?foo=bar`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.say("<esi:vars>$(ESI_ARGS{a}|noarg)</esi:vars>");
    res.say("<esi:vars>$(ESI_ARGS{b}|noarg)</esi:vars>");
    res.say("<esi:vars>$(ESI_ARGS|noarg)</esi:vars>");
    res.end("OK");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`noarg\nnoarg\nnoarg\nOK`);
});

test("TEST 35b: ESI_ARGS works", async () => {
  const url = `/esi/test-35`;
  routeHandler.add(`${url}?foo=bar`, function (req, res) {
    res.writeHead(200, esiHead);
    res.say("<esi:vars>$(ESI_ARGS{a}|noarg)</esi:vars>");
    res.say("<esi:vars>$(ESI_ARGS{b}|noarg)</esi:vars>");
    res.say("<esi:vars>$(ESI_ARGS|noarg)</esi:vars>");
    res.end("OK");
  });
  const res = await makeRequest(`${url}?esi_a=test&foo=bar`);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`test\nnoarg\nesi_a=test\nOK`);
});

test.todo("TEST 36: No error if res.has_esi incorrectly set_debug");

test("TEST 37: SSRF", async () => {
  const url = `/esi/test-37`;
  routeHandler.add(
    `${url}?evil=foo%22/%3E%3Cesi:include%20src=%22/bad_frag%22%20/%3E`,
    function (req, res) {
      res.writeHead(200, esiHead);
      res.end(`<esi:include src="${url}/fragment_1?$(QUERY_STRING{evil})" />`);
    }
  );
  routeHandler.add(
    `${url}/fragment_1?foo%22/&gt;&lt;esi:include%20src=%22/bad_frag%22%20/&gt;`,
    function (req, res) {
      res.writeHead(200, esiHead);
      res.end(`FRAGMENT`);
    }
  );
  const res = await makeRequest(
    `${url}?evil=foo"/><esi:include src="/bad_frag" />`
  );
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`FRAGMENT`);
});

test("TEST 38: SSRF via <esi:vars>", async () => {
  const url = `/esi/test-38`;
  routeHandler.add(
    `${url}?evil=%3Cesi:include%20src=%22/bad_frag%22%20/%3E`,
    function (req, res) {
      res.writeHead(200, esiHead);
      res.end(`<esi:vars>$(QUERY_STRING{evil})</esi:vars>`);
    }
  );
  const res = await makeRequest(`${url}?evil=<esi:include src="/bad_frag" />`);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`&lt;esi:include src="/bad_frag" /&gt;`);
});

test("TEST 39: XSS via <esi:vars>", async () => {
  const url = `/esi/test-39`;
  routeHandler.add(
    `${url}?evil=%3Cscript%3Ealert(%22HAXXED%22);%3C/script%3E`,
    function (req, res) {
      res.writeHead(200, esiHead);
      res.say(`<esi:vars>$(QUERY_STRING{evil})</esi:vars>`);
      res.end(`<esi:vars>$(RAW_QUERY_STRING{evil})</esi:vars>`);
    }
  );
  const res = await makeRequest(
    `${url}?evil=<script>alert("HAXXED");</script>`
  );
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `&lt;script&gt;alert("HAXXED");&lt;/script&gt;\n<script>alert("HAXXED");</script>`
  );
});

test("TEST 40: ESI vars in when/choose blocks are replaced", async () => {
  const url = `/esi/test-40`;
  const content = `<esi:choose>
<esi:when test="1 == 1">$(QUERY_STRING{a})
$(RAW_QUERY_STRING{tag})
$(QUERY_STRING{tag})
</esi:when>
<esi:otherwise>
Will never happen
</esi:otherwise>
</esi:choose>`;
  routeHandler.add(
    `${url}?a=1&tag=foo%3Cscript%3Ealert(%22bad!%22)%3C/script%3Ebar`,
    function (req, res) {
      res.writeHead(200, esiHead);
      res.end(content);
    }
  );
  const res = await makeRequest(
    `${url}?a=1&tag=foo<script>alert("bad!")</script>bar`
  );
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `1\nfoo<script>alert("bad!")</script>bar\nfoo&lt;script&gt;alert("bad!")&lt;/script&gt;bar\n`
  );
});

test("TEST 41: Vars inside when/choose blocks are not evaluated before esi includes", async () => {
  const url = `/esi/test-41`;
  const content = `BEFORE $(QUERY_STRING{a})
<esi:choose><esi:when test="1 == 1">
<esi:include src="${url}/fragment_1?test=$(QUERY_STRING{evil})" />
$(QUERY_STRING{a})
</esi:when><esi:otherwise>Will never happen</esi:otherwise></esi:choose>
AFTER`;
  routeHandler.add(
    `${url}?a=test&evil=%22%3Cesi:include%20src=%22/bad_frag%22%20/%3E`,
    function (req, res) {
      res.writeHead(200, esiHead);
      res.end(content);
    }
  );
  routeHandler.add(
    `${url}/fragment_1?test=%22&lt;esi:include%20src=%22/bad_frag%22%20/&gt;`,
    function (req, res) {
      res.writeHead(200, esiHead);
      res.end("FRAGMENT");
    }
  );
  const res = await makeRequest(
    `${url}?a=test&evil="<esi:include src="/bad_frag" />`
  );
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `BEFORE $(QUERY_STRING{a})\n\nFRAGMENT\ntest\n\nAFTER`
  );
});

test("TEST 42: By default includes to 3rd party domains are allowed", async () => {
  const url = `/esi/test-42`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(
      `<esi:include src="https://jsonplaceholder.typicode.com/todos/1" />`
    );
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `{\n  "userId": 1,\n  "id": 1,\n  "title": "delectus aut autem",\n  "completed": false\n}`
  );
});

test("TEST 43: Disable third party includes", async () => {
  const url = `/esi/test-43`;
  config.disableThirdPartyIncludes = true;
  parser = new esi(config);
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(
      `<esi:include src="https://jsonplaceholder.typicode.com/todos/1" />`
    );
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(``);
});

test("TEST 44: White list third party includes", async () => {
  const url = `/esi/test-44`;
  config.disableThirdPartyIncludes = true;
  config.thirdPatyIncludesDomainWhitelist = ["jsonplaceholder.typicode.com"];
  parser = new esi(config);
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(
      `<esi:include src="https://jsonplaceholder.typicode.com/todos/1" />`
    );
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `{\n  "userId": 1,\n  "id": 1,\n  "title": "delectus aut autem",\n  "completed": false\n}`
  );
});

test("TEST 45: Cookies and Authorization propagate to fragment on same domain", async () => {
  const url = `/esi/test-45`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`<esi:include src="${url}/fragment_1" />`);
  });
  routeHandler.add(`${url}/fragment_1`, function (req, res) {
    res.writeHead(200, esiHead);
    res.say(`method: ${req.method}`);
    for (const [key, value] of Object.entries(req.headers)) {
      res.say(`${key}: ${value}`);
    }
    res.end();
  });
  const res = await makeRequest(url, {
    method: "POST",
    headers: {
      "Cache-Control": "no-cache",
      Cookie: "foo",
      Authorization: "bar",
      Range: "bytes=0-",
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `method: GET\nhost: ${testingDetails.hostname}:${testingDetails.port}\nconnection: keep-alive\naccept-encoding: gzip, deflate\nauthorization: bar\ncache-control: no-cache\ncookie: foo\nmf-loop: 1\nsurrogate-capability: cloudflareWorkerESI="ESI/1.0"\nx-esi-parent-uri: http://localhost:${port}/esi/test-45\nx-esi-recursion-level: 1\n`
  );
});

test("TEST 45b: Cookies and Authorization don't propagate to fragment on different domain", async () => {
  const url = `/esi/test-45b`;
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`<esi:include src="https://mockbin.org/request" />`);
  });
  const res = await makeRequest(url, {
    method: "POST",
    headers: {
      "Cache-Control": "no-cache",
      Cookie: "foo",
      Authorization: "bar",
      Range: "bytes=0-",
      Accept: "text/plain",
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  const text = await res.text();
  expect(text).toMatch(/(.*)"method": "GET",/);
  expect(text).toMatch(/(.*)"cache-control": "no-cache",/);
  expect(text).not.toMatch(/(.*)"authorization": "bar",/);
  expect(text).not.toMatch(/(.*)"cookie": "foo",/);
});

test("TEST 46: Cookie var blacklist", async () => {
  const url = `/esi/test-46`;
  config.varsCookieBlacklist = ["not_allowed"];
  parser = new esi(config);
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    // Blacklist should apply to expansion in vars
    res.say(`<esi:vars>$(HTTP_COOKIE)</esi:vars>`);
    // And by key
    res.say(
      `<esi:vars>$(HTTP_COOKIE{allowed}):$(HTTP_COOKIE{not_allowed})</esi:vars>`
    );
    // ... and also in URIs
    res.end(
      `<esi:include src="${url}/fragment_1?&allowed=$(HTTP_COOKIE{allowed})&not_allowed=$(HTTP_COOKIE{not_allowed})" />`
    );
  });
  routeHandler.add(
    `${url}/fragment_1?&allowed=yes&not_allowed=`,
    function (req, res) {
      res.writeHead(200, esiHead);
      const url = new URL(req.url as string, testingDetails.url);
      res.say(`FRAGMENT:${url.search}`);
      res.end(`${req.headers["cookie"]}`);
    }
  );

  const res = await makeRequest(url, {
    headers: {
      Cookie: "allowed=yes; also_allowed=yes; not_allowed=no",
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `allowed=yes; also_allowed=yes\nyes:\nFRAGMENT:?&allowed=yes&not_allowed=\nallowed=yes; also_allowed=yes; not_allowed=no`
  );
});

test("TEST 46b: Cookie var blacklist on fragment", async () => {
  const url = `/esi/test-46b`;
  config.varsCookieBlacklist = ["not_allowed"];
  parser = new esi(config);
  routeHandler.add(`${url}/fragment_1`, function (req, res) {
    res.writeHead(200, esiHead);
    // Blacklist should apply to expansion in vars
    res.say(`<esi:vars>$(HTTP_COOKIE)</esi:vars>`);
    // And by key
    res.say(
      `<esi:vars>$(HTTP_COOKIE{allowed}):$(HTTP_COOKIE{not_allowed})</esi:vars>`
    );
    // ... and also in URIs
    res.end(
      `<esi:include src="${url}/fragment_2?&allowed=$(HTTP_COOKIE{allowed})&not_allowed=$(HTTP_COOKIE{not_allowed})" />`
    );
  });
  routeHandler.add(url, function (req, res) {
    res.writeHead(200, esiHead);
    res.end(`<esi:include src="${url}/fragment_1" />`);
  });
  routeHandler.add(
    `${url}/fragment_2?&allowed=yes&not_allowed=`,
    function (req, res) {
      res.writeHead(200, esiHead);
      const url = new URL(req.url as string, testingDetails.url);
      res.say(`FRAGMENT:${url.search}`);
      res.end(`${req.headers["cookie"]}`);
    }
  );

  const res = await makeRequest(url, {
    headers: {
      Cookie: "allowed=yes; also_allowed=yes; not_allowed=no",
    },
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `allowed=yes; also_allowed=yes\nyes:\nFRAGMENT:?&allowed=yes&not_allowed=\nallowed=yes; also_allowed=yes; not_allowed=no`
  );
});

test("TEST 47: Query string", async () => {
  const url = `/esi/test-47`;
  routeHandler.add(`${url}?foo=Bar`, function (req, res) {
    res.writeHead(200, esiHead);
    res.write("<esi:vars>$(ESI_ARGS)</esi:vars>:");
    res.write("<esi:vars>name:$(ESI_ARGS{name})</esi:vars>:");
    res.end("<esi:vars>$(QUERY_STRING)$(QUERY_STRING{esi_name})</esi:vars>");
  });
  const res = await makeRequest(`${url}?esi_name=James&foo=Bar&esi_foo=Bar`);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    "esi_name=James&esi_foo=Bar:name:James:foo=Bar"
  );
});

test("TEST 48: POST With body", async () => {
  const url = `/esi/test-48`;
  const postBody = "POST BODY";
  routeHandler.add(url, function (req, res) {
    let str = "";
    req.on("data", (chunk) => {
      str += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(str);
    });
  });
  const res = await makeRequest(url, {
    method: "POST",
    body: postBody,
  });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(postBody);
});
