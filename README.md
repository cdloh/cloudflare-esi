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
    - [thirdPatyIncludesDomainWhitelist](#thirdpatyincludesdomainwhitelist)
    - [varsCookieBlacklist](#varscookieblacklist)
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
   options?: // Config
   customESIFunction?: // Custom ESI Vars Function
   fetcher?: // Custom Fetch Function
   postBodyFunction?: // Optional function that will be called once the body has been completed
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
  thirdPatyIncludesDomainWhitelist?: string[];
  varsCookieBlacklist?: string[];
};

// defaults
const defaultConfig = {
   allowSurrogateDelegation: false,
   contentTypes: ["text/html", "text/plain"],
   disableThirdPartyIncludes: false,
   recursionLimit: 10,
   thirdPatyIncludesDomainWhitelist: [],
   varsCookieBlacklist: []
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

Also see thirdPatyIncludesDomainWhitelist for usage with this.



#### recursionLimit

* *default*: `10`
* *type*: `number`

Levels of recusion the parser is allowed to go do. Think includes that include themselves causing recusion


#### thirdPatyIncludesDomainWhitelist

* *default*: `[]`
* *type*: `string[]`

If third party includes are disabled, you can also explicitly provide a whitelist of allowed third party domains.

#### varsCookieBlacklist

* *default*: `[]`
* *type*: `string[]`

Cookie names given here will not be expandable as ESI variables: e.g. `$(HTTP_COOKIE)` or `$(HTTP_COOKIE{foo})`. However they are not removed from the request data, and will still be propagated to `<esi:include>` subrequests.

This is useful if your client is sending a sensitive cookie that you don't ever want to accidentally evaluate in server output.




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
new esi(undefined, geoIPVarsFromRequest)

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
new esi(undefined, undefined, customFetcher)

```


### Optional Post Body Function

If you need to do extra work once the body has completed streaming, eg you record how many fetches your custom fetcher handles. Or need to fire off some context.waitUntil functions at the end you can fire them after this function has been called.


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
