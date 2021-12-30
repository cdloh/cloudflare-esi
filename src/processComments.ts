const removeCommentsRegex = /<esi:comment (?:.*?)\/>/gs

export async function process(chunk: string): Promise<string> {
	if (chunk.indexOf("<esi:comment") == -1) {
		return chunk
	}

	// Change to replaceAll once upgraded node
	return chunk.replace(removeCommentsRegex, "")
}

