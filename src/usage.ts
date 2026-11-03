import { extractVars } from "./processESIVars";
import type { ESIIncludeReport } from "./types";

export const esi_include_pattern = /<esi:include\s*src="([^"]+)"\s*\/>/;
const esiIncludeGlobal = new RegExp(esi_include_pattern.source, "g");
const esiVarsBlockGlobal = /<esi:vars>(.*?)<\/esi:vars>/gs;

/**
 * Collects what a single document's own body uses, for the onDocumentProcessed hook.
 *
 * Usage is gathered statically from the raw ESI in the document rather than as
 * things are evaluated. That way vars in `esi:choose` branches that were not taken
 * still count. Callers want to know if the output *could* vary per request.
 */
export class UsageCollector {
  vars = new Set<string>();
  esiArgs = new Set<string>();
  includes: ESIIncludeReport[] = [];
  conditionals = false;
  varsBlock = false;
  varsInIncludeSrc = false;
  recursionLimitHit = false;

  /**
   * Scans a chunk of ESI. Expects the chunk after `<!--esi` escaping, comments and
   * `esi:remove` have been handled, but before vars and conditionals are evaluated.
   *
   * @param {string} text chunk of ESI
   */
  scan(text: string): void {
    const hasChoose = text.indexOf("<esi:choose") !== -1;
    if (hasChoose || /<esi:(?:when|otherwise)[\s>]/.test(text)) {
      this.conditionals = true;
    }

    // Anything that evaluates vars
    const evaluated: string[] = [];

    for (const block of text.matchAll(esiVarsBlockGlobal)) {
      this.varsBlock = true;
      evaluated.push(block[1]);
    }

    for (const include of text.matchAll(esiIncludeGlobal)) {
      if (extractVars(include[1]).length) {
        this.varsInIncludeSrc = true;
      }
      evaluated.push(include[1]);
    }

    // Text inside a choose gets its vars evaluated as well as the tests
    // We don't know which branch will be taken so take all of it
    if (hasChoose) {
      evaluated.push(text);
    }

    for (const str of evaluated) {
      for (const { name, key } of extractVars(str)) {
        this.vars.add(key === null ? name : `${name}{${key}}`);
        if (name == "ESI_ARGS") {
          this.esiArgs.add(key === null ? "esi_*" : `esi_${key}`);
        }
      }
    }
  }
}
