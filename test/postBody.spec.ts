import { expect, test } from "vitest";
import { checkSurrogate, reply, testingDetails, urlHandler } from "./helpers";
import { esi, ESIConfig } from "../src";

const esiHead = {
  "Content-Type": "text/html",
  "Surrogate-Control": `content="ESI/1.0"`,
};

let parser: esi;
const makeRequest = async function (request: string, details?: RequestInit) {
  const reqUrl = new URL(request, `http://localhost:${port}`).toString();
  const req = new Request(reqUrl, details);
  return parser.parse(req);
};

const routeHandler = new urlHandler();
const port = testingDetails.port;

test("TEST 1: postBody Function", async () => {
  const url = `/post-body/test-1`;
  let count = 0;
  const postBody = function () {
    expect(count).toEqual(3);
    count++;
    return;
  };
  parser = new esi(undefined, undefined, undefined, undefined, postBody);

  const printFragment = function (req: Request) {
    const res = reply();
    count++;
    const url = new URL(req.url as string, `http://localhost:${port}`);
    const query = url.searchParams.get("a") ? url.searchParams.get("a") : "";
    return res.end(`FRAGMENT: ${query}\n`);
  };
  routeHandler.add(url, function () {
    const res = reply(200, esiHead);
    res.say("1");
    res.write(`<esi:include src="${url}/fragment_1" />`);
    res.say("2");
    res.write(`<esi:include src="${url}/fragment_1?a=2" />`);
    res.write("3");
    return res.end(
      `<esi:include src="http://localhost:${port}${url}/fragment_1?a=3" />`,
    );
  });
  routeHandler.add(`${url}/fragment_1`, printFragment);
  routeHandler.add(`${url}/fragment_1?a=2`, printFragment);
  routeHandler.add(`${url}/fragment_1?a=3`, printFragment);
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(
    `1\nFRAGMENT: \n2\nFRAGMENT: 2\n3FRAGMENT: 3\n`,
  );
  expect(count).toEqual(4);
});

test("TEST 2: postBody Function non esi", async () => {
  const url = `/post-body/test-2`;
  let count = 0;
  const postBody = function () {
    expect(count).toEqual(1);
    count++;
    return;
  };
  parser = new esi(undefined, undefined, undefined, undefined, postBody);

  routeHandler.add(url, function () {
    count++;
    const res = reply(200);
    return res.end("hello i am a body");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`hello i am a body`);
  expect(count).toEqual(2);
});
