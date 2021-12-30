import { replace_vars } from "./processESIVars";
import esi, { ESIConfig } from ".";
import { ESIEventData } from ".";

const esi_include_pattern = /<esi:include\s*src="[^"]+"\s*\/>/;
const esi_src_pattern = /src="([^"]+)"/;

export async function process(
  eventData: ESIEventData,
  chunk: string,
  evalVars: boolean
): Promise<string> {
  if (chunk.indexOf("<esi:include") == -1) {
    if (evalVars) {
      return replace_vars(eventData, chunk);
    } else {
      return chunk;
    }
  }

  const res = [];
  let retFrom = 0;

  do {
    chunk = chunk.substring(retFrom);
    const includeMatch = chunk.match(esi_include_pattern);

    if (includeMatch && includeMatch.index !== undefined) {
      const before = chunk.substring(retFrom, includeMatch.index);

      retFrom = includeMatch.index + includeMatch[0].length;
      res.push(evalVars ? replace_vars(eventData, before) : before);

      const include = await fetchInclude(eventData, includeMatch[0]);

      // Already escaped by the fetcher
      res.push(include);
    } else {
      // push the remainder
      res.push(evalVars ? replace_vars(eventData, chunk) : chunk);
      break;
    }

    // eslint-disable-next-line no-constant-condition
  } while (true);

  return res.join("");
}

async function fetchInclude(eventData: ESIEventData, include: string) {
  const src = parseSrcAttribute(eventData, include);

  if (!src) {
    // No src. Cant do anything
    return "";
  }

  // TY JS for handling relatives etc for us
  const srcUrl = new URL(src, eventData.url.toString());
  const req = new Request(srcUrl.toString());
  const sameDomain = isIncludeOnSameDomain(eventData.url, srcUrl);

  // Not the same domain are we even allowed to include this
  if (!sameDomain && !thirdPartyWhitelisted(eventData.config, srcUrl.host)) {
    return "";
  }

  // Add authorization and cookie data if on the same domain
  if (sameDomain) {
    if (eventData.request.headers.get("Authorization")) {
      req.headers.set(
        "Authorization",
        eventData.request.headers.get("Authorization") as string
      );
    }
    if (eventData.request.headers.get("Cookie")) {
      req.headers.set(
        "Cookie",
        eventData.request.headers.get("Cookie") as string
      );
    }
  }

  // Add our recursion level and parent uri
  req.headers.set(
    "X-ESI-Recursion-Level",
    (eventData.recursion + 1).toString()
  );
  req.headers.set("X-ESI-Parent-URI", eventData.request.url);
  if (eventData.request.headers.get("Cache-Control")) {
    req.headers.set(
      "Cache-Control",
      eventData.request.headers.get("Cache-Control") as string
    );
  }

  // create a new parser with current config
  const parser = new esi(eventData.config);
  const includeRes = await parser.parse(req, eventData.recursion + 1);

  if (!includeRes.body) {
    // Nothing for us to do here
    return "";
  }

  const resTxt = await includeRes.text();

  return resTxt;
}

function parseSrcAttribute(eventData: ESIEventData, include: string) {
  const src = include.match(esi_src_pattern);

  if (!src) {
    return null;
  }

  return replace_vars(eventData, src[1]);
}

function isIncludeOnSameDomain(requestURL: URL, srcURL: URL): boolean {
  return srcURL.hostname == requestURL.hostname;
}

function thirdPartyWhitelisted(config: ESIConfig, host: string): boolean {
  if (config.disableThirdPartyIncludes) {
    if (!config.thirdPatyIncludesDomainWhitelist) {
      return false;
    }

    return config.thirdPatyIncludesDomainWhitelist.includes(host);
  }

  return true;
}
