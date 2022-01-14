import { ESIEventData } from ".";
import { tagParser } from "./tagParser";
import { replace_vars, esi_eval_var } from "./processESIVars";

const esi_when_pattern = /(?:<esi:when)\s+(?:test="(.+?)"\s*>)/;

/**
 * Takes a chunk of text and processes any esi:choose tags and returns processed chunk
 * along with a boolean indicating if the chunk had any conditionals
 *
 * @param {ESIEventData} esiData ESI Data for this request
 * @param {string} chunk Chunk of text in string form to process
 * @param {Array<string>} [res] array of already processed chunks of string
 * @returns {Promise<[string, boolean]>} return processed string and boolean indicating if any instructions were processed
 */
export async function process(
  esiData: ESIEventData,
  chunk: string,
  res: Array<string> = []
): Promise<[string, boolean]> {
  const parser = new tagParser(chunk);
  let after;
  let hasConditionals = false;

  do {
    const [choose, ch_before, ch_after] = await parser.next("esi:choose");

    if (choose && choose.closing) {
      hasConditionals = true;
      if (ch_before) {
        res.push(ch_before);
      }

      // Anything after the final choose
      // To be added afterwards
      if (ch_after) {
        after = ch_after;
      }

      const innerParser = new tagParser(choose.contents as string);

      let whenMatched = false;
      let otherwise = null;

      do {
        const [tag, ,] = await innerParser.next("esi:when|esi:otherwise");

        if (tag && tag.closing && tag.whole && tag.contents) {
          if (tag.tagname == "esi:when" && !whenMatched) {
            // eslint-disable-next-line no-inner-declarations, jsdoc/require-jsdoc
            async function processWhen(match: RegExpMatchArray) {
              const condition = match[1];
              const conditionValidated = await _esi_evaluate_condition(
                esiData,
                condition
              );

              if (tag && tag.contents && conditionValidated) {
                whenMatched = true;
                if (tag.contents.indexOf("esi:choose") !== -1) {
                  await process(esiData, tag.contents as string, res);
                } else {
                  res.push(tag.contents);
                }
              }
            }

            const match = tag.whole.match(esi_when_pattern);
            if (match) await processWhen(match);
          } else if (tag.tagname == "esi:otherwise") {
            otherwise = tag.contents;
          }
        }

        if (!tag) {
          break;
        }

        // eslint-disable-next-line no-constant-condition
      } while (true);

      if (!whenMatched && otherwise) {
        if (otherwise.indexOf("<esi:choose") !== -1) {
          await process(esiData, otherwise, res);
        } else {
          res.push(otherwise);
        }
      }
    }

    if (!choose) {
      break;
    }

    // eslint-disable-next-line no-constant-condition
  } while (true);

  if (after) {
    res.push(after);
  }

  if (hasConditionals) {
    return [res.join(""), true];
  } else {
    return [chunk, false];
  }
}

const regexExtractor = /\/(.*?)(?<!\\)\/([a-z]*)/;

/**
 * Evaluates esi Vars within when tag conditional statements
 *
 * @param {ESIEventData} eventData current request event data
 * @param {string[]} match regex match of the var
 * @returns {string} evaluated esi var
 */
function esi_eval_var_in_when_tag(
  eventData: ESIEventData,
  match: [String: string, ...args: string[]]
) {
  const varInTag = esi_eval_var(eventData, match);

  const number = parseInt(varInTag, 10);
  if (number) {
    return number.toString();
  } else {
    // Change to replaceAll once upgraded node
    return "'" + varInTag.replace(/'/g, "\\'") + "'";
  }
}

/**
 * Takes a condition string and turns it into javascript to be ran
 * if the condition is invalid returns null otherwise the compiled string
 *
 * @param {string} condition conditional string to build out
 * @returns {null[] | [boolean, string]} valid condition compiled or null
 */
async function _esi_condition_lexer(condition: string) {
  const reg_esi_condition =
    /(\d+(?:\.\d+)?)|(?:'(.*?)(?<!\\)')|(!=|!|\|{1,2}|&{1,2}|={2}|=~|\(|\)|<=|>=|>|<)/g;
  const op_replacements: { [key: string]: string } = {
    "!=": "!==",
    "|": " || ",
    "&": " && ",
    "||": " || ",
    "&&": " && ",
    "!": " ! ",
  };

  const lexer_rules: { [key: string]: { [key: string]: boolean } } = {
    number: {
      nil: true,
      operator: true,
    },
    string: {
      nil: true,
      operator: true,
    },
    operator: {
      nil: true,
      number: true,
      string: true,
      operator: true,
    },
  };

  const tokens: Array<string> = [];
  let prev_type = "nil";
  let expectingPattern = false;

  const tokensSplit = condition.matchAll(reg_esi_condition);
  for (const token of tokensSplit) {
    const number = token[1];
    const string = token[2];
    const operator = token[3];
    let token_type = "nil";

    if (number) {
      token_type = "number";
      tokens.push(number);
    } else if (string) {
      token_type = "string";
      if (expectingPattern) {
        const regex = string.match(regexExtractor);
        if (!regex) {
          return [null, null];
        } else {
          const pattern = regex[1];
          const options = regex[2];
          const cmpString = tokens.pop();

          // tokens.push(`(${cmpString}.search(/${pattern}/${options}) !== -1)`)
          tokens.push(`/${pattern}/${options}.test(${cmpString})`);
        }
        expectingPattern = false;
      } else {
        tokens.push(`'${string}'`);
      }
    } else if (operator) {
      token_type = "operator";
      if (operator == "=~") {
        if (prev_type == "operator") {
          return [null, null];
        } else {
          expectingPattern = true;
        }
      } else {
        tokens.push(op_replacements[operator] || operator);
      }
    }

    if (prev_type !== "nil") {
      if (!lexer_rules[prev_type][token_type]) {
        return [null, null];
      }
    }
    // Derefence it
    prev_type = `${token_type}`;
  }

  return [true, tokens.join(" ")];
}

/**
 * Takes a condition and verifies if its true or false
 *
 * @param {ESIEventData} esiData current request event data
 * @param {string} condition condition to test
 * @returns {Promise<boolean>} condition result
 */
async function _esi_evaluate_condition(
  esiData: ESIEventData,
  condition: string
): Promise<boolean> {
  // Check for variables
  condition = replace_vars(esiData, condition, esi_eval_var_in_when_tag);

  const [ok, compiledCondition] = await _esi_condition_lexer(condition);

  if (!ok) {
    return false;
  }

  try {
    const ret: boolean = Function(
      `"use strict"; return( ${compiledCondition} )`
    )();
    return ret;
  } catch (err) {
    return false;
  }
}
