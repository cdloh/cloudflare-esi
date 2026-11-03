# Cloudflare ESI

An RFC compliant [ESI](https://www.w3.org/TR/esi-lang) parser based off the [Ledge](https://github.com/ledgetech/ledge) openresty module written in TypeScript!

Built for usage within Cloudflare workers.


Library supports all instructions that the Ledge parser supports. Also supports [Custom Fetch Functions](#custom-fetch-function) so you can use the Cache API or any other custom caching logic.

- [Installation](#installation)
- [Usage](#usage)
- [API](#api)
  - [Config](#config)
    - [allowSurrogateDelegation](#allowsurrogatedelegation)
    - [contentTypes](#contenttypes)
    - [disableThirdPartyIncludes](#disablethirdpartyincludes)
    - [recursionLimit](#recursionlimit)
    - [surrogateControlHeader](#surrogatecontrolheader)
    - [thirdPartyIncludesDomainWhitelist](#thirdpartyincludesdomainwhitelist)
    - [varsCookieBlacklist](#varscookieblacklist)
    - [onDocumentProcessed](#ondocumentprocessed)
    - [onIncludeStart and onIncludeComplete](#onincludestart-and-onincludecomplete)
    - [includeTapHighWaterMark](#includetaphighwatermark)
  - [Streaming includes](#streaming-includes)
  - [Custom ESI Vars Function](#custom-esi-vars-function)
  - [Custom Fetch Function](#custom-fetch-function)
  - [Optional Post Body Function](#optional-post-body-function)
- [Caching and upstream requests](#caching-and-upstream-requests)
- [Edge Side Includes](#edge-side-includes)
  - [Regular expressions in conditions](#regular-expressions-in-conditions)
  - [ESI Args](#esi-args)
  - [Variable Escaping](#variable-escaping)
  - [Missing ESI features](#missing-esi-features)
- [Author](#author)
- [Thanks](#thanks)
- [Licence](#licence)

## Installation

```sh
$ npm install cloudflare-esi
```

## Usage

Using within your worker is as easy as including it and passing your request to it!

```javascript
import esi from "cloudflare-esi"

export default {
   async fetch(request: Request, env: any, ctx: any) {
      const parser = new esi()
      return parser.parse(request)
   }
}

```

## API

```javascript
new esi(
   config?: ESIConfig // one object holding the settings below, plus esiFunction, fetcher, ctx and postBodyFunction
)

esi.parse(
   request: Request,
   recursion?: number // level to start at. 0 (the default) for the root
)
```

### Config

Main config object

```javascript
export type ESIConfig = {
  allowSurrogateDelegation?: boolean | string[];
  contentTypes?: string[];
  disableThirdPartyIncludes?: boolean;
  recursionLimit?: number;
  surrogateControlHeader?: string;
  thirdPartyIncludesDomainWhitelist?: string[];
  varsCookieBlacklist?: string[];
  onDocumentProcessed?: (report: ESIDocumentReport) => void | Promise<void>;
  onIncludeStart?: (info: ESIIncludeStartInfo) => WritableStream<Uint8Array> | undefined | Promise<WritableStream<Uint8Array> | undefined>;
  onIncludeComplete?: (info: ESIIncludeCompleteInfo) => void | Promise<void>;
  includeTapHighWaterMark?: number;
  esiFunction?: (request: Request) => CustomVars | Promise<CustomVars>; // CustomVars is { [key: string]: string | { [key: string]: string } }. See "Custom ESI Vars"
  fetcher?: (request: Request, ctx: Request[]) => Promise<Response>; // see "Custom Fetch Function"
  ctx?: Request[]; // parent requests passed to the fetcher. Normally left out
  postBodyFunction?: () => void | Promise<void>; // see "Optional Post Body Function"
};

// defaults
const defaultConfig = {
   allowSurrogateDelegation: false,
   contentTypes: ["text/html", "text/plain"],
   disableThirdPartyIncludes: false,
   recursionLimit: 10,
   surrogateControlHeader: 'Surrogate-Control',
   thirdPartyIncludesDomainWhitelist: [],
   varsCookieBlacklist: [],
   includeTapHighWaterMark: 1048576
   // onDocumentProcessed, onIncludeStart and onIncludeComplete have no default. Nothing is called
}
```

#### allowSurrogateDelegation

* *default*: `false`
* *type*: `boolean | string[]`

[ESI Surrogate Delegation](http://www.w3.org/TR/edge-arch) allows for downstream intermediaries to advertise a capability to process ESI instructions nearer to the client. By setting this to true any downstream offering this will disable ESI processing in the processor, delegating it downstream.

When set to an array of IP address strings, delegation will only be allowed to requests that come from IPs that match. The `CF-Connecting-IP` header is compared.

 This may be important if ESI instructions contain sensitive data which must be removed.

#### contentTypes

* *default*: `["text/html", "text/plain"]`
* *type*: `string[]`

Specifies content types to perform ESI processing on. All other content types will not be considered for processing and responses will be returned as is.

This field is case sensitive.

#### disableThirdPartyIncludes

* *default*: `false`
* *type*: `boolean`

Whether or not to enable third party includes (includes from other domains).

If set to false and an include points to another domain the include will be returned as a blank string

Also see thirdPartyIncludesDomainWhitelist for usage with this.



#### recursionLimit

* *default*: `10`
* *type*: `number`

Levels of recursion the parser is allowed to go do. Think includes that include themselves causing recusion

#### surrogateControlHeader

* *default*: `Surrogate Control`
* *type*: `string`

Name of the header that the library will check for Surrogate-Control. We allow customisation as Cloudflare priorities Surrogate-Control over Cache-Control


#### thirdPartyIncludesDomainWhitelist

* *default*: `[]`
* *type*: `string[]`

If third party includes are disabled, you can also explicitly provide a whitelist of allowed third party domains.

#### varsCookieBlacklist

* *default*: `[]`
* *type*: `string[]`

Cookie names given here will not be expandable as ESI variables: e.g. `$(HTTP_COOKIE)` or `$(HTTP_COOKIE{foo})`. However they are not removed from the request data, and will still be propagated to `<esi:include>` subrequests.

This is useful if your client is sending a sensitive cookie that you don't ever want to accidentally evaluate in server output.



#### onDocumentProcessed

* *default*: none
* *type*: `(report: ESIDocumentReport) => void | Promise<void>`

Called once for every document the parser fetches, the root and each include, after that document's own body has been completely processed. It is also called for documents that were not processed for ESI (`isESI: false`), when it fires as soon as the response headers have been looked at.

The report describes that document's own body only, never its descendants. Use `ctx` (the parent chain) to tie the reports of a page together.

```typescript
type ESIDocumentReport = {
  request: Request;          // request as sent to the fetcher (ESI args removed)
  response: Response;        // fetcher response. Headers only; the hook must not read the body
  recursion: number;         // 0 = root
  ctx: Request[];            // parent chain, same as passed to the fetcher
  isESI: boolean;            // false if the document was passed through without being processed
  includes: Array<{ src: string; resolvedUrl: string; thirdParty: boolean; allowed: boolean }>;
  usedVars: string[];        // eg ["HTTP_COOKIE{foo}", "GEOIP_COUNTRY_CODE", "QUERY_STRING"]
  usedEsiArgs: string[];     // eg ["esi_foo"]. "esi_*" for $(ESI_ARGS) with no key
  usedConditionals: boolean; // esi:choose / esi:when / esi:otherwise
  usedEsiVarsBlock: boolean; // an esi:vars block
  varsInIncludeSrc: boolean; // an include src contained a $(...) expression
  recursionLimitHit: boolean;// an include was skipped because of recursionLimit
  aborted: boolean;          // the output of this document did not complete
}
```

```javascript
const parser = new esi({
  onDocumentProcessed: (report) => {
    // eg is this document's output something that could vary per request?
    const varies = report.usedVars.length > 0 || report.usedConditionals
    console.log(report.request.url, report.recursion, varies)
  }
})
```

* `usedVars`, `usedEsiArgs`, `usedConditionals`, `usedEsiVarsBlock` and `varsInIncludeSrc` are taken from the raw document, wherever vars are evaluated (`esi:vars` blocks, `esi:when` tests, include `src`, and the inside of `esi:choose`). This includes branches of an `esi:choose` that weren't taken. They answer "*could* this output vary per request" not "did it". A `RAW_` prefix is dropped: `$(RAW_HTTP_HOST)` is reported as `HTTP_HOST`.
* `includes` lists the includes that were actually attempted, in the order they were found, including ones that the third party rules skipped (`allowed: false`). It does not list includes in branches that weren't taken, or any that were not attempted because of `recursionLimit` (that sets `recursionLimitHit`). `src` is as written in the document, `resolvedUrl` is after vars have been evaluated.
* `isESI` is `true` only when the parser actually processed the document. If the content type or `Surrogate-Control` doesn't match, there is no body, or [surrogate delegation](#allowsurrogatedelegation) was used, it is `false` and all the usage fields are empty/false.
* `aborted` is `true` if this document's output didn't complete: whoever was reading the output went away, or reading the document failed.
* For ESI documents the hook is awaited before that document's output stream is closed. Whoever is reading the root's output will see the reports of the whole page by the time the stream ends. A slow hook delays the end of the stream.
* Anything the hook throws is logged and ignored, it can't change the output.

#### onIncludeStart and onIncludeComplete

* *default*: none
* *type*: `onIncludeStart: (info) => WritableStream<Uint8Array> | undefined | Promise<...>`, `onIncludeComplete: (info) => void | Promise<void>`

Lets you take a copy of each include's *rendered* output (with its own includes already inlined) while the parent is being rendered, without buffering it. For example to store every include as a separate object in a cache.

```typescript
type ESIIncludeStartInfo = { request: Request; ctx: Request[]; recursion: number }
type ESIIncludeCompleteInfo = ESIIncludeStartInfo & { aborted: boolean; error?: unknown }
```

```javascript
const parser = new esi({
  onIncludeStart: ({ request }) => {
    // Return a WritableStream to be given a copy of the include's output
    // or undefined to not bother with this one
    const { readable, writable } = new IdentityTransformStream()
    ctx.waitUntil(cache.put(request.url, new Response(readable)))
    return writable
  },
  onIncludeComplete: ({ request, aborted, error }) => {
    // The include and everything beneath it has finished. All the reports for it have been sent
  }
})
```

* `onIncludeStart` is called just before the include's output starts flowing into its parent. Which, as includes are written in document order, may be later than when the include was fetched. `request` and `ctx` are what the include's fetcher was given, `recursion` is the include's level (1 and up). The root document is never offered, you can tee that yourself.
* If a `WritableStream` is returned it is given the same bytes that are spliced into the parent.
* The copy never holds up the parent. If the tap's writable falls more than [includeTapHighWaterMark](#includetaphighwatermark) bytes behind it is aborted and the parent carries on without it.
* The tap's writable is closed only if the include completed cleanly. If the output goes away or the include's own stream errors, it is aborted (with that reason) instead, so you never commit a partial object.
* `onIncludeComplete` is called once the include and everything beneath it has finished. It always runs after every [onDocumentProcessed](#ondocumentprocessed) call for that include's subtree. `aborted` is `true` if the output went away before the include completed. `error` is set if the include's own stream errored; the parent carries on, as any bytes already written can't be taken back. Neither is set just because a tap was dropped for being too slow, your writable is told directly. The parent doesn't finish until the `onIncludeComplete` calls of its includes have, but it doesn't wait for your tap writables to finish flushing.
* Includes that were never fetched (third party rules, `recursionLimit`) aren't offered.
* Anything the hooks throw is logged and ignored. A throwing `onIncludeStart` is treated as returning `undefined`.

#### includeTapHighWaterMark

* *default*: `1048576` (1MB)
* *type*: `number`

How many bytes an `onIncludeStart` writable may be behind (bytes given to it that it hasn't accepted yet) before it's aborted.

```javascript
new esi({ includeTapHighWaterMark: 256 * 1024, onIncludeStart })
```

### Streaming includes

Includes are not buffered. Each include's body is piped straight into the parent's output as soon as it's that include's turn. Output order is the same as it always has been, but memory use no longer depends on the size of the includes.

* Includes are still fetched as soon as they are found, concurrently. A later include that is ready early waits as an unread stream until the includes before it have been written.
* Includes are only read as fast as the output is consumed. If the client is slow, nothing reads ahead of it beyond normal stream queueing.
* The parser also stops reading a document's own text when about 1MB of it is waiting to be written, until the consumer catches up.
* The stream the parser writes to is an `IdentityTransformStream`, as workerd's plain `TransformStream` stops applying backpressure once its reader has started reading.


### Custom ESI Vars Function

```
export type customESIVarsFunction = (request: Request) => Promise<customESIVars> | customESIVars;
export type customESIVars = {
   [key: string]: string | { [key: string]: string };
};
```

If you want to inject custom ESI vars into the parser per request you can pass the class a custom async function that will be evaluated each request.

The function accepts a request object, returns an object and can be async.

The object values can either be strings or objects. If the value is an object it the ESIVar must be refrenced with a key in the ESI variable or the default variable will be returned.

eg that pulls GEOIP data out of the Request and injects it as `GEOIP_X` ESI Vars

```javascript
const geoIPVarsFromRequest = function (request) {
  let customVariables = {};
  let cfData = request.cf;
  let geoipVars = [
    'colo',
    'country',
    'city',
    'continent',
    'latitude',
    'longitude',
    'postalCode',
    'metroCode',
    'region',
    'regionCode',
    'timezone',
  ]


  geoipVars.forEach(function(key) {
    var value = '';
    if(cfData[key]) { value = cfData[key] }

    customVariables[`GEOIP_${key.toUpperCase()}`] = value;
  })

  return customVariables

}

// create a new parser with default config
new esi({ esiFunction: geoIPVarsFromRequest })

```


### Custom Fetch Function

Normally the parser uses the `fetch` API under the hood to make subrequests to get Responses, however if you want to use things like the Cache API within your worker you can pass a custom Fetcher function that will be used for all subrequests.

The function must follow the same API as the normal `Fetch` function.

eg function. Note this function has been defined in a scope where event already exists.

```javascript
const customFetcher = async function(request) {

  const cache = caches.default

  // Check whether the value is already available in the cache
  // if not, you will need to fetch it from origin, and store it in the cache
  // for future access
  let response = await cache.match(cacheKey)

  if (!response) {
    // If not in cache, get it from origin
    response = await fetch(request)

    // Must use Response constructor to inherit all of response's fields
    response = new Response(response.body, response)

    // Cache API respects Cache-Control headers. Setting s-max-age to 10
    // will limit the response to be in cache for 10 seconds max

    // Any changes made to the response here will be reflected in the cached value
    response.headers.append("Cache-Control", "s-maxage=10")

    // Store the fetched response as cacheKey
    // Use waitUntil so you can return the response without blocking on
    // writing to cache
    event.waitUntil(cache.put(cacheKey, response.clone()))
  }
  return response

}

// create a new parser with default config
new esi({ fetcher: customFetcher })

```


### Optional Post Body Function

If you need to do extra work once the body has completed streaming, eg you record how many fetches your custom fetcher handles. Or need to fire off some context.waitUntil functions at the end you can fire them after this function has been called.

```javascript
new esi({
  postBodyFunction: () => {
    console.log("parse complete")
  },
})
```


## Caching and upstream requests

Unlike Ledge the Cloudflare ESI library uses [fetch API](https://developers.cloudflare.com/workers/runtime-apis/fetch) for all upstream requests. As such it relies on configuration at that layer to handle caching. Ensure that you have Page Rules and correct cache headers sent from the origin so that Cloudflare will cache the responses correctly.

## Edge Side Includes

### Regular expressions in conditions

In addition to the operators defined in the [ESI specification](https://www.w3.org/TR/esi-lang), the parser also support regular expressions in conditions (as string literals), using the `=~` operator.

```html
<esi:choose>
   <esi:when test="$(QUERY_STRING{name}) =~ '/james|john/i'">
      Hi James or John
   </esi:when>
</esi:choose>
```

The regex is parsed as a standard Javascript regex.

*Note*: Regex expressions must be quoted and surrounded by //'s for the parser to pick them up.

### ESI Args

It can be tempting to use URI arguments to pages using ESI in order to change layout dynamically, but this comes at the cost of generating multiple cache items - one for each permutation of URI arguments.

ESI args is a neat feature to get around this, by using the `esi_` [prefix](#esi_args_prefix). URI arguments with this prefix are removed from the upstream request, and instead stuffed into the `$(ESI_ARGS{foo})` variable for use in ESI, typically in conditions. That is, think of them as magic URI arguments which have meaning for the ESI processor only, and should never affect cacheability or upstream content generation.

`$> curl -H "Host: example.com" http://cache.example.com/page1?esi_display_mode=summary`

```html
<esi:choose>
   <esi:when test="$(ESI_ARGS{display_mode}) == 'summary'">
      <!-- SUMMARY -->
   </esi:when>
   <esi:when test="$(ESI_ARGS{display_mode}) == 'details'">
      <!-- DETAILS -->
   </esi:when>
</esi:choose>
```

In this example, the `esi_display_mode` values of `summary` or `details` will return the same cache HIT, but display different content.

If `$(ESI_ARGS)` is used without a field key, it renders the original query string arguments, e.g. `esi_foo=bar&esi_display_mode=summary`, URL encoded.

### Variable Escaping

ESI variables are minimally escaped by default in order to prevent user's injecting additional ESI tags or XSS exploits.

Unescaped variables are available by prefixing the variable name with `RAW_`. This should be used with care.

```html
# /esi/test.html?a=<script>alert()</script>
<esi:vars>
$(QUERY_STRING{a})     <!-- &lt;script&gt;alert()&lt;/script&gt; -->
$(RAW_QUERY_STRING{a}) <!--  <script>alert()</script> -->
</esi:vars>
```

### Missing ESI features

The following parts of the [ESI specification](https://www.w3.org/TR/esi-lang) are not supported, but could be in due course if a need is identified.

* `<esi:inline>` not implemented (or advertised as a capability).
* No support for the `onerror` or `alt` attributes for `<esi:include>`. Instead, we "continue" on error by default.
* `<esi:try | attempt | except>` not implemented.
* The "dictionary (special)" substructure variable type for `HTTP_USER_AGENT` is not implemented.


## Author

Callum Loh <callumloh@gmail.com>

## Thanks

Big thanks to James Hurt and the rest of the Ledge team for the original module this is based off.

Also thanks to MrSwitch for inspiration from their [ESI repo](https://github.com/MrSwitch/esi)


## Licence

This module is licensed under the 2-clause BSD license.

Copyright (c) Callum Loh <callumloh@gmail.com>

All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
