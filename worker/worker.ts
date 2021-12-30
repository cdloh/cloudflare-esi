import esi from "../src"

export default {
	async fetch(request: Request, env: any, ctx: any) {
		const parser = new esi()
		return parser.parse(request)
	}
}
