import { tagParser } from "./tagParser";

export function create(writer: Function) {

	let tag_hint: string | null
	let prev_chunk = "";

	return async function ({ value, done }: { value: string, done: boolean }) {

		if (tag_hint) {
			value = tag_hint + value
			tag_hint = null
		}

		value = prev_chunk + value

		let parser = new tagParser(value);
		do {
			let tag, before, after
			[tag, before, after] = await parser.next()

			if (tag && tag.whole) {
				if (before) {
					writer(before, false)
				}
				writer(tag.whole, true)

				// TODO figure out how to stop this
				// we know that after is set if whole is set
				// @ts-ignore
				value = after
				prev_chunk = ""
			} else if (tag && !tag.whole) {
				if (typeof before == "string" && before.length !== 0) {
					writer(before, false)
				}

				prev_chunk = tag.opening.tag + after
				break
			} else {
				let incompleteTag = value.search(/<(?:!--)?esi/);
				if (incompleteTag !== -1) {
					prev_chunk = prev_chunk
					break
				}

				let hintMatch = value.slice(-6).match(/(?:<!--es|<!--e|<!--|<es|<!-|<e|<!|<)$/)
				if (hintMatch) {
					tag_hint = hintMatch[0]
					value = value.substring(0, value.length - tag_hint.length)
				}
				if (typeof value == "string" && value.length !== 0) {
					writer(value, false)
				}
				break
			}

		} while (true)

		// Check if we had something left over
		// But we didnt write it
		if (done) {
			if (typeof prev_chunk == "string" && prev_chunk.length !== 0) {
				writer(prev_chunk, false)
			}
		}
	}
}
