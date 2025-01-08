import { checkSurrogate, testResponse, urlHandler } from "./helpers";
import { esi, ESIConfig } from "../src";
import { AddressInfo } from "net";
import http from "http";

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

afterAll((done) => {
  server.close(() => {
    done();
  });
});

test("TEST 1: postBody Function", async () => {
  const url = `/post-body/test-1`;
  let count = 0;
  const postBody = function () {
    expect(count).toEqual(3);
    count++;
    return;
  };
  parser = new esi(undefined, undefined, undefined, undefined, postBody);

  const printFragment = function (
    req: http.IncomingMessage,
    res: testResponse,
  ) {
    count++;
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

  routeHandler.add(url, function (req, res) {
    count++;
    res.writeHead(200);
    res.end("hello i am a body");
  });
  const res = await makeRequest(url);
  expect(res.ok).toBeTruthy();
  expect(checkSurrogate(res)).toBeTruthy();
  expect(await res.text()).toEqual(`hello i am a body`);
  expect(count).toEqual(2);
});
