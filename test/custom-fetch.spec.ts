import { checkSurrogate } from "./helpers";
import { esi, ESIConfig, fetchFunction } from "../src";

const esiHead = {
  "Content-Type": "text/html",
  "Surrogate-Control": `content="ESI/1.0"`,
};

let parser: esi;
let config: ESIConfig;
const makeRequest = async function (request: string, details?: RequestInit) {
  const reqUrl = new URL(request, `http://localhost`).toString();
  const req = new Request(reqUrl, details);
  return parser.parse(req);
};

beforeEach(() => {
  config = {
    contentTypes: ["text/html", "text/plain"],
  };
  parser = new esi(config);
});

afterEach(async () => {
  config = {
    contentTypes: ["text/html", "text/plain"],
  };
});

test("TEST 1: Custom Fetcher", async () => {
  const url = `/esi/test-1`;
  const customFetch: fetchFunction = async function (request) {
    return new Response("CONTENT HERE");
  };
  parser = new esi(config, undefined, customFetch);
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual("CONTENT HERE");
});

test("TEST 2: Custom Fetcher with ESI", async () => {
  const url = `/esi/test-2/?a=1&b=2&c=3`;
  const customFetch: fetchFunction = async function (request) {
    return new Response(
      `BEFORE
<!--esi<esi:vars>$(QUERY_STRING{a})</esi:vars>
<!--esi<esi:vars>$(QUERY_STRING{b})</esi:vars>
-->MIDDLE
<esi:vars>$(QUERY_STRING{c})</esi:vars>
-->AFTER`,
      { headers: esiHead },
    );
  };
  parser = new esi(config, undefined, customFetch);
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual("BEFORE\n1\n2\nMIDDLE\n3\nAFTER");
});

test("TEST 3: Custom Fetcher with ESI with includes", async () => {
  const url = `/esi/test-3`;
  let responseNo = 0;
  const customFetch: fetchFunction = async function (request) {
    responseNo++;
    if (responseNo == 1)
      return new Response(
        `BEFORE <esi:include src="${url}/fragment_1" /> AFTER`,
        { headers: esiHead },
      );
    return new Response("OK");
  };
  parser = new esi(config, undefined, customFetch);
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual("BEFORE OK AFTER");
  expect(responseNo).toBe(2);
});

test("TEST 4: Custom Fetcher might want to use the POST Body", async () => {
  const url = `/esi/test-4`;
  const customFetch: fetchFunction = async function (request) {
    const r = request as Request;
    return new Response(r.bodyUsed.toString());
  };
  parser = new esi(config, undefined, customFetch);
  const res = await makeRequest(url, { method: "POST", body: "POST BODY" });
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual("false");
});
