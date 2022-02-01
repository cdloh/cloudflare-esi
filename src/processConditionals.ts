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

// All of our ESI regexs
const regexExtractor = /\/(.*?)(?<!\\)\/([a-z]*)/;
const reg_esi_seperator = /(?:'.*?(?<!\\)')|(\|{1,2}|&{1,2})/g;
const reg_esi_brackets = /(?:'.*?(?<!\\)')|(\(|\))/g;
const reg_esi_condition =
  /(\d+(?:\.\d+)?)|(?:'(.*?)(?<!\\)')|(!=|!|\|{1,2}|&{1,2}|={2}|=~|\(|\)|<=|>=|>|<)/g;

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
): string {
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
 * Takes a condition string and splits it into its two sides and operator
 * passes that to the tester and returns the result
 *
 * @param {string} condition conditional string to split
 * @returns {boolean} condition result
 */
async function _esi_condition_lexer(condition: string): Promise<boolean> {
  const op_replacements: { [key: string]: string } = {
    "!=": "!==",
    "|": "||",
    "&": "&&",
    "||": "||",
    "&&": "&&",
    "!": "!",
  };

  let left: number | string | boolean | null = null;
  let right: number | string | boolean | null = null;
  let op: string | null = null;
  const setLR = function (value: number | string | boolean): void {
    left !== null ? (right = value) : (left = value);
  };

  const tokensSplit = condition.matchAll(reg_esi_condition);
  for (const token of tokensSplit) {
    const number = token[1];
    let string: string | boolean = token[2];
    const operator = token[3];

    if (number) {
      setLR(number);
    } else if (string) {
      if (string === "false" || string === "true") {
        string = string === "true";
      }
      setLR(string);
    } else if (operator) {
      op = op_replacements[operator] || operator;
    }

    if (left !== null && right !== null && op !== null) {
      return esiConditionTester(left, right, op);
    }
  }

  return false;
}

/**
 * Takes a condition broken down into an a, b & operator and tests the data
 * returns the result
 *
 * @param {string | number | boolean} left conditional left
 * @param {string | number | boolean} right conditional right
 * @param {string} operator operator to compare
 * @returns {boolean} condition result
 */
function esiConditionTester(
  left: string | number | boolean,
  right: string | number | boolean,
  operator: string
): boolean {
  switch (operator) {
    case "==":
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case ">=":
      return left >= right;
    case "<=":
      return left <= right;
    case "<":
      return left < right;
    case ">":
      return left > right;
    case "=~": {
      if (typeof left !== "string" || typeof right !== "string") return false;
      const regex = right.match(regexExtractor);
      if (!regex) return false;
      // Bloody javascript!
      // Gotta cleanup some escaping here
      // Only have to do it for regex'd strings
      // As normal comparison strings should be escaped the same (need to be to be equal)
      left = left.replace(/\\"/g, '"');
      left = left.replace(/\\'/g, "'");
      left = left.replace(/\\\\/g, "\\");
      const reg = new RegExp(regex[1], regex[2]);
      return reg.test(left);
    }
  }
  return false;
}

/**
 * Takes a condition string and splits it into parts splitting along a seperator
 * seperators are logical seperators ie `|` or `&`
 * passes the splits along to ${_esi_condition_lexer} and then
 * returns the result of the condition after comparing the splits
 * against their logical seperators
 *
 * @param {string} condition conditional string to split
 * @returns {boolean} condition result
 */
async function esi_seperator_splitter(condition: string): Promise<boolean> {
  let startingIndex = 0;
  let preResult: null | boolean = null;
  let preSeperator: null | string = null;

  const tokensSplit = condition.matchAll(reg_esi_seperator);

  for (const token of tokensSplit) {
    if (!token[1]) continue;
    const seperator = token[1];

    // We dont need to worry about it so lets keep going
    if (preResult && (seperator == "|" || seperator == "||")) {
      continue;
    }

    const conditionBefore = condition
      .substring(startingIndex, token.index)
      .trim();

    let conditionResult: boolean;
    // We already have a result to this
    // So convert it and return it
    if (conditionBefore == "false" || conditionBefore == "true") {
      conditionResult = conditionBefore === "true";
    } else {
      conditionResult = await _esi_condition_lexer(conditionBefore);
    }

    // If the condition result is false && it has to be true
    // bail out
    if (!conditionResult && (seperator == "&" || seperator == "&&")) {
      return false;
    }

    // save our results and keep going
    preResult = conditionResult;
    preSeperator = seperator;
    // Move onto the next one
    startingIndex = (token.index as number) + preSeperator.length;
  }

  if ((preSeperator == "|" || preSeperator == "||") && preResult) {
    return preResult as boolean;
  }

  const finalString = condition.substring(startingIndex).trim();
  let finalResult: boolean;
  // We already have a result to this
  // So convert it and return it
  if (finalString == "false" || finalString == "true") {
    finalResult = finalString === "true";
  } else {
    finalResult = await _esi_condition_lexer(finalString);
  }

  return finalResult;
}

/**
 * Takes a condition string and splits it into seperate parts based off
 * brackets amd passes the splits along to ${esi_seperator_splitter} and then
 * returns the result of the condition
 *
 * @param {string} condition conditional string to split
 * @returns {boolean} condition result
 */
async function esi_bracket_splitter(condition: string): Promise<boolean> {
  let parsedPoint = 0;
  let startingIndex = 0;
  let endIndex = -1;
  let depth = 0;
  let conditionAfter: null | string = null;
  const fullExpression: string[] = [];

  const tokensSplit = condition.matchAll(reg_esi_brackets);

  for (const token of tokensSplit) {
    if (!token[1]) continue;
    const bracket = token[1];
    if (bracket == "(") {
      if (depth == 0) startingIndex = token.index as number;
      depth = depth + 1;
    }
    if (bracket == ")") {
      // bail out if its invalid depth
      if (depth == 0) return false;
      depth = depth - 1;

      // Right we have a full bracketed set
      if (depth == 0) {
        endIndex = token.index as number;
        fullExpression.push(condition.substring(parsedPoint, startingIndex));
        const conditionBracketed = condition.substring(
          startingIndex + 1,
          endIndex
        );

        // Loop it back to see if there is another bracket inside
        const bracketResult = await esi_bracket_splitter(conditionBracketed);
        fullExpression.push(bracketResult.toString());

        // Grab anything that is left
        conditionAfter = condition.substring(endIndex + 1);

        // Know were we are up too
        parsedPoint = endIndex + 1;
      }
    }
  }

  if (endIndex == -1) {
    fullExpression.push(condition);
  }
  if (conditionAfter) {
    fullExpression.push(conditionAfter);
  }

  const condResult = await esi_seperator_splitter(fullExpression.join(""));
  return condResult;
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
  return await esi_bracket_splitter(condition);
}
