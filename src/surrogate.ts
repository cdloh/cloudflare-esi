
export async function advertiseSurrogateControl(request: Request): Promise<Request> {
  let coloName: string = ""
  if (request.cf && request.cf.colo) {
    coloName = `-${request.cf.colo}`
  }
  request.headers.append("Surrogate-Capability", `cloudflareWorkerESI${coloName}="ESI/1.0"`)
  return request
}
