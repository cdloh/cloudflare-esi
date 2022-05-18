import { replace_vars } from "./processESIVars";
import esi, { customESIVarsFunction, ESIConfig, fetchFunction } from ".";
import { ESIEventData } from ".";

const esi_include_pattern = /<esi:include\s*src="([^"]+)"\s*\/>/;

/**
 * Handles any <esi:include tags in supplied chunk
 * returns processed chunk as a string
 *
 * @param {ESIEventData} eventData config for the current request
 * @param {string} chunk chunk of text that we are about to process
 * @param {boolean} evalVars Whether or not we need to process any esi Vars in the content
 * @param {fetchFunction} fetcher original fetch function from ESI Class
 * @param {customESIFunction} [customESIFunction] original customESIFunction if defined in the ESI Class
 * @returns {string} processed chunk as a string
 */
export async function process(
  eventData: ESIEventData,
  chunk: string,
  evalVars: boolean,
  fetcher: fetchFunction,
  customESIFunction?: customESIVarsFunction
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
      // Push anything from before the tag into the response
      const before = chunk.substring(0, includeMatch.index);
      res.push(evalVars ? replace_vars(eventData, before) : before);

      // Keep the remainder for next chunk
      retFrom = includeMatch.index + includeMatch[0].length;

      const include = await fetchInclude(
        eventData,
        includeMatch[1], // pass the src tag straight through
        fetcher,
        customESIFunction
      );

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

/**
 * Handles fetching the include
 * If we aren't allowed to include returns a blank string
 * Otherwise parses the include and returns it as a string
 *
 * @param {ESIEventData} eventData config for the current request
 * @param {string} include the full include tag from the content
 * @param {fetchFunction} fetcher original fetch function from ESI Class
 * @param {customESIFunction} [customESIFunction] original customESIFunction if defined in the ESI Class
 * @returns {string} result of the include as a string
 */
async function fetchInclude(
  eventData: ESIEventData,
  include: string,
  fetcher: fetchFunction,
  customESIFunction?: customESIVarsFunction
): Promise<string> {
  // replace any vars in the src string
  const src = replace_vars(eventData, include);

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
  const parser = new esi(eventData.config, customESIFunction, fetcher);
  const includeRes = await parser.parse(req, eventData.recursion + 1);

  if (!includeRes.body) {
    // Nothing for us to do here
    return "";
  }

  const resTxt = await includeRes.text();

  return resTxt;
}

/**
 * Checks if the include is on the same domain as the original request
 * Returns false if not
 *
 * @param {URL} requestURL Original Request URL
 * @param {URL} srcURL URL that we are about to include
 * @returns {boolean} true if on the same domain
 */
function isIncludeOnSameDomain(requestURL: URL, srcURL: URL): boolean {
  return srcURL.hostname == requestURL.hostname;
}

/**
 * checks if a third party domain is whitelisted based off the current
 * running config
 *
 * @param {ESIConfig} config config for the current request
 * @param {string} host host to check against
 * @returns {boolean} true if domain is whitelisted. false if not
 */
function thirdPartyWhitelisted(config: ESIConfig, host: string): boolean {
  if (config.disableThirdPartyIncludes) {
    if (!config.thirdPatyIncludesDomainWhitelist) {
      return false;
    }

    return config.thirdPatyIncludesDomainWhitelist.includes(host);
  }

  return true;
}
