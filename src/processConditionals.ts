import { ESIEventData } from ".";
import { tagParser } from "./tagParser";
import { replace_vars, esi_eval_var } from "./processESIVars"



let esi_when_pattern = /(?:<esi:when)\s+(?:test="(.+?)"\s*>)/

export async function process(esiData: ESIEventData, chunk: string, res?: Array<string>, recursion?: number): Promise<[string, boolean]> {
	if (!recursion) { recursion = 0 }
	if (!res) { res = [] }

	let parser = new tagParser(chunk);
	let after;
	let hasConditionals = false;

	do {
		let choose, ch_before, ch_after
		[choose, ch_before, ch_after] = await parser.next("esi:choose")

		if (choose && choose.closing) {
			hasConditionals = true;
			if (ch_before) {
				res.push(ch_before);
			}

			// Anything after the final choose
			// To be added afterwards
			if (ch_after) {
				after = ch_after
			}

			let innerParser = new tagParser(choose.contents!);

			let whenMatched = false
			let otherwise = null

			do {
				let [tag, before, after] = await innerParser.next("esi:when|esi:otherwise")

				if (tag && tag.closing && tag.whole && tag.contents) {
					if (tag.tagname == "esi:when") {
						async function processWhen(match: RegExpMatchArray) {

							let condition = match[1];

							let conditionValidated = await _esi_evaluate_condition(esiData, condition)
							if (conditionValidated) {
								whenMatched = true;
								// @ts-ignore
								if (tag.contents.indexOf("esi:choose") !== -1) {
									// @ts-ignore
									await process(esiData, tag.contents, res, recursion + 1)
								} else {
									// @ts-ignore
									res.push(tag.contents)
								}
							}
						}

						let match = tag.whole.match(esi_when_pattern)
						if (match) await processWhen(match)
					} else if (tag.tagname == "esi:otherwise") {
						otherwise = tag.contents
					}
				}

				if (!tag) { break }

			} while (true)

			if (!whenMatched && otherwise) {
				if (otherwise.indexOf("<esi:choose") !== -1) {
					await process(esiData, otherwise, res, recursion + 1)
				} else {
					res.push(otherwise)
				}
			}

		}

		if (!choose) { break }

	} while (true)

	if (after) {
		res.push(after)
	}

	if (hasConditionals) {
		return [res.join(''), true]
	} else {
		return [chunk, false]
	}

}

var reg_trim = /(^\s+|\s+$)/;
var reg_esi_condition = /(\d+(?:\.\d+)?)|(?:'(.*?)(?<!\\)')|(\!=|!|\|{1,2}|&{1,2}|={2}|=~|\(|\)|<=|>=|>|<)/g;
var reg_esi_condition_separator = /\s+(\||\&\&|\&)\s+/g;
var regexExtractor = /\/(.*?)(?<!\\)\/([a-z]*)/

function esi_eval_var_in_when_tag(eventData: ESIEventData, match: [String: string, ...args: any[]]) {

	let varInTag = esi_eval_var(eventData, match)

	let number = parseInt(varInTag, 10);
	if (number) {
		return number.toString();
	} else {
		// Change to replaceAll once upgraded node
		return "\'" + varInTag.replace(/'/g, "\\'") + "\'"
	}
}

async function _esi_condition_lexer(condition: string) {

	let reg_esi_condition = /(\d+(?:\.\d+)?)|(?:'(.*?)(?<!\\)')|(\!=|!|\|{1,2}|&{1,2}|={2}|=~|\(|\)|<=|>=|>|<)/g;
	let op_replacements: { [key: string]: string } = {
		"!=": "!==",
		"|": " || ",
		"&": " && ",
		"||": " || ",
		"&&": " && ",
		"!": " ! "
	}

	let lexer_rules: { [key: string]: { [key: string]: boolean } } = {
		'number': {
			'nil': true,
			'operator': true
		},
		'string': {
			'nil': true,
			'operator': true,
		},
		'operator': {
			'nil': true,
			'number': true,
			'string': true,
			'operator': true,
		}
	}

	let tokens: Array<string> = []
	let prev_type = "nil"
	let expectingPattern = false

	let tokensSplit = condition.matchAll(reg_esi_condition)
	for (const token of tokensSplit) {
		let number = token[1]
		let string = token[2]
		let operator = token[3]
		let token_type = 'nil'

		if (number) {
			token_type = "number"
			tokens.push(number);
		} else if (string) {
			token_type = "string"
			if (expectingPattern) {
				let regex = string.match(regexExtractor)
				if (!regex) {
					return [null, null]
				} else {
					let pattern = regex[1]
					let options = regex[2]
					let cmpString = tokens.pop()

					// tokens.push(`(${cmpString}.search(/${pattern}/${options}) !== -1)`)
					tokens.push(`/${pattern}/${options}.test(${cmpString})`)
				}
				expectingPattern = false;
			} else {
				tokens.push(`'${string}'`)
			}
		} else if (operator) {
			token_type = "operator"
			if (operator == "=~") {
				if (prev_type == "operator") {
					return [null, null]
				} else {
					expectingPattern = true
				}
			} else {
				tokens.push(op_replacements[operator] || operator)
			}
		}

		if (prev_type !== "nil") {
			if (!lexer_rules[prev_type][token_type]) {
				return [null, null]
			}
		}
		// Derefence it
		prev_type = `${token_type}`
	}

	return [true, tokens.join(" ")]
}

async function _esi_evaluate_condition(esiData: ESIEventData, condition: string) {

	// Check for variables
	condition = replace_vars(esiData, condition, esi_eval_var_in_when_tag)

	let [ok, compiledCondition] = await _esi_condition_lexer(condition)

	if (!ok) { return false }

	try {
		let ret = Function(`"use strict"; return( ${compiledCondition} )`)()
		return ret
	} catch (err) {
		return false
	}

}

