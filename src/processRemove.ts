let removeTagsRegex = /(<esi:remove>.*?<\/esi:remove>)/gs

export async function process(chunk: string) {
	if (chunk.indexOf("<esi:remove") == -1) {
		return chunk
	}
	// Change to replaceAll once upgraded node
	let ret = chunk.replace(removeTagsRegex, "")
	return ret
}

