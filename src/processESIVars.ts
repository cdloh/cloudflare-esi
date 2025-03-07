import { parse } from "worktop/cookie";
import { ESIEventData, esiArgsPrefix } from ".";

const esiVarsRegex = /(<esi:vars>)(.*?)(<\/esi:vars>)/gs;
const esiVarsPatternRegex =
  /\$\(([A-Z_]+){?([a-zA-Z.\-~_%0-9]*)}?\|?(?:([^\s)']+)|'([^')]+)')?\)/gs;
const esiGreaterArrow = /</g;
const esiLessArrow = />/g;

/**
 * Processes <esi:var> tags within a chunk of text
 * returns the processed chunk
 *
 * @param {ESIEventData} eventData event data for the current request
 * @param {string} chunk string to process
 * @returns {string} processed string
 */
export function process(eventData: ESIEventData, chunk: string): string {
  if (chunk.indexOf("esi:vars") == -1) {
    return chunk;
  }

  return chunk.replace(esiVarsRegex, function (...match) {
    // Change to replaceAll once upgraded node
    return replace_vars(eventData, match[2]);
  });
}

type replaceFunction = (
  eventData: ESIEventData,
  var_match: [String: string, ...args: string[]],
) => string;

/**
 * Processes a string and replaces any esi vars within string
 * returns the processed chunk
 *
 * @param {ESIEventData} eventData event data for the current request
 * @param {string} str string to replace vars in
 * @param {Function} [cb] optional function to pass matches too
 * @returns {string} processed string
 */
export function replace_vars(
  eventData: ESIEventData,
  str: string,
  cb: replaceFunction = esi_eval_var,
): string {
  return str.replace(esiVarsPatternRegex, function (...match) {
    return cb(eventData, match);
  });
}

/**
 * Takes an ESI Var and evaluates it
 * Escapes string if required
 *
 * @param {ESIEventData} eventData event data for the current request
 * @param {string[]} var_match var to evaluate
 * @returns {string} processed string
 */
export function esi_eval_var(
  eventData: ESIEventData,
  var_match: [String: string, ...args: string[]],
): string {
  let escape = true;
  const var_name = var_match[1];
  if (var_name.substring(0, 4) == "RAW_") {
    escape = false;
    var_match[1] = var_name.substring(4);
  }

  let res = _esi_eval_var(eventData, var_match);

  if (escape || res.indexOf("<esi") !== -1) {
    // Change to replaceAll once upgraded node
    res = res.replace(esiGreaterArrow, "&lt;");
    res = res.replace(esiLessArrow, "&gt;");
  }

  return res;
}

/**
 * Takes an ESI Var and evaluates it
 * Escapes string if required
 *
 * @param {ESIEventData} eventData event data for the current request
 * @param {string[]} var_pattern var to evaluate
 * @returns {string} processed string
 */
function _esi_eval_var(
  eventData: ESIEventData,
  var_pattern: [String: string, ...args: string[]],
): string {
  const var_name = var_pattern[1] || "";
  const key = var_pattern[2] == "" ? null : var_pattern[2];

  const default_var = var_pattern[3] || var_pattern[4] || "";

  if (var_name == "QUERY_STRING") {
    const queryString = eventData.url.searchParams;
    if (!key) {
      // no key
      // Return it all we have a query string
      // Otherwise return the default
      return queryString.toString() == ""
        ? default_var
        : queryString.toString();
    }

    // return either the default or all of the key data
    if (queryString.has(key)) {
      return queryString.getAll(key).join(", ");
    } else {
      return default_var;
    }
  } else if (var_name.substring(0, 5) == "HTTP_") {
    const headers = eventData.headers;
    const header = var_name.substring(5);
    if (header == "COOKIE") {
      const cookies = parse(headers[header] || "");
      if (key) {
        if (
          eventData.config.varsCookieBlacklist &&
          eventData.config.varsCookieBlacklist.includes(key)
        ) {
          return "";
        } else {
          return cookies[key] || default_var;
        }
      }
      const res = [];
      // Only include our non black listed ones
      for (const cookie in cookies) {
        if (
          eventData.config.varsCookieBlacklist &&
          eventData.config.varsCookieBlacklist.includes(cookie)
        ) {
          continue;
        }
        res.push(`${cookie}=${cookies[cookie]}`);
      }
      return res.join("; ");
    } else {
      if (!headers[header]) {
        return default_var;
      }
      if (header == "ACCEPT_LANGUAGE" && key && headers[header]) {
        const laguageExists = headers[header].search(key) > -1;

        // return them as strings not bools
        return laguageExists ? "true" : "false";
      } else {
        return headers[header];
      }
    }
  } else if (var_name == "ESI_ARGS") {
    const esiArgs = eventData.esiArgs;
    if (esiArgs.toString() == "") {
      return default_var;
    }
    if (!key) {
      return esiArgs.toString();
    } else {
      const keyWithPrefix = `${esiArgsPrefix}${key}`;
      return esiArgs.has(keyWithPrefix)
        ? esiArgs.getAll(keyWithPrefix).join(", ")
        : default_var;
    }
  } else {
    const customVaribles = eventData.customVars;
    if (customVaribles) {
      const customVar = customVaribles[var_name];
      if (customVar) {
        if (key) {
          if (typeof customVar == "object") {
            return customVar[key] || default_var;
          }
        } else {
          if (typeof customVar == "object") {
            return default_var;
          }
          return customVar;
        }
      }
    }
    return default_var;
  }
}
