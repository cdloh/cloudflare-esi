# Cloudflare ESI

An RFC compliant [ESI](https://www.w3.org/TR/esi-lang) parser based off the [Ledge](https://github.com/ledgetech/ledge) openresty module.

Library supports all instructions that the Ledge parser supports.

* [Licence](#licence)


## Installation

TODO

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
