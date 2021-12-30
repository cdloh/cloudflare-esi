import { tagParser } from "./tagParser";
import { replace_vars } from './processESIVars'
import esi from ".";
import { ESIEventData } from ".";

let esi_include_pattern = /<esi:include\s*src="[^"]+"\s*\/>/
let esi_src_pattern = /src="([^"]+)"/

export async function process(eventData: ESIEventData, chunk: string, evalVars: boolean) {

	if (chunk.indexOf("<esi:include") == -1) {
		if (evalVars) {
			return replace_vars(eventData, chunk)
		} else {
			return chunk
		}
	}

	let res = []
	let retFrom = 0

	do {

		chunk = chunk.substring(retFrom)
		let includeMatch = chunk.match(esi_include_pattern)

		if (includeMatch && includeMatch.index !== undefined) {
			let before = chunk.substring(retFrom, includeMatch.index)

			retFrom = includeMatch.index + includeMatch[0].length;
			res.push(evalVars ? replace_vars(eventData, before) : before)

			let include = await fetchInclude(
				eventData,
				includeMatch[0]
			)

			// Already escaped by the fetcher
			res.push(include)
		} else {
			// push the remainder
			res.push(evalVars ? replace_vars(eventData, chunk) : chunk)
			break;
		}

	} while (true)

	return res.join("")
}

async function fetchInclude(eventData: ESIEventData, include: string) {

	let src = parseSrcAttribute(eventData, include)

	if (!src) {
		// No src. Cant do anything
		return ""
	}

	// TY JS for handling relatives etc for us
	let req = new Request(new URL(src, eventData.url.toString()).toString());

	// create a new parser
	let parser = new esi();
	let includeRes = await parser.parse(req, eventData.recursion + 1);

	if (!includeRes.body) {
		// Nothing for us to do here
		return ""
	}

	let resTxt = await includeRes.text()

	return resTxt
}

function parseSrcAttribute(eventData: ESIEventData, include: string) {
	let src = include.match(esi_src_pattern)

	if (!src) {
		return null
	}

	return replace_vars(eventData, src[1])
}
