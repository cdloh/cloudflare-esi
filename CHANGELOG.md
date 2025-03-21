## [0.5.1](https://github.com/cdloh/cloudflare-esi/compare/v0.5.0...v0.5.1) (2025-03-19)


### Bug Fixes

* dont clone request when creating a mutable request ([090b166](https://github.com/cdloh/cloudflare-esi/commit/090b16638b156d3cc55a0ffc6d427fa519031199))

# [0.5.0](https://github.com/cdloh/cloudflare-esi/compare/v0.4.2...v0.5.0) (2025-03-06)


### Features

* allow setting a custom Surrogate-Control header ([69bd80b](https://github.com/cdloh/cloudflare-esi/commit/69bd80b0e93e6f0d4858df78c96d0e2517fa1f50)), closes [#282](https://github.com/cdloh/cloudflare-esi/issues/282)

## [0.4.2](https://github.com/cdloh/cloudflare-esi/compare/v0.4.1...v0.4.2) (2025-02-11)


### Bug Fixes

* Cleanup useless async and awaits & custom ESI Vars function doesn't have to be async ([6ee4f6b](https://github.com/cdloh/cloudflare-esi/commit/6ee4f6bd08a1a61a8afe4f7e776de8c70616aac3))

## [0.4.1](https://github.com/cdloh/cloudflare-esi/compare/v0.4.0...v0.4.1) (2025-01-10)


### Bug Fixes

* redo the fetch function definition to not require request init details ([0f4bb71](https://github.com/cdloh/cloudflare-esi/commit/0f4bb718c0cf20e42248028cfda62cf23f2fa41e))

# [0.4.0](https://github.com/cdloh/cloudflare-esi/compare/v0.3.1...v0.4.0) (2025-01-09)


### Bug Fixes

* incorrectly named thirdPartyIncludesDomainWhitelist ([a72442a](https://github.com/cdloh/cloudflare-esi/commit/a72442acf0df84e790d6f0978b4809f84e62bab2))


### Features

* pass request context to fetch function ([402805e](https://github.com/cdloh/cloudflare-esi/commit/402805ec8cf3a2b59f034fc21c37a7f47d13daa8))

## [0.3.1](https://github.com/cdloh/cloudflare-esi/compare/v0.3.0...v0.3.1) (2024-09-27)


### Bug Fixes

* also trigger postbody function on non esi responses ([e84948a](https://github.com/cdloh/cloudflare-esi/commit/e84948a7f4997d3de5465fa6ffc860aa87f309d1))

# [0.3.0](https://github.com/cdloh/cloudflare-esi/compare/v0.2.5...v0.3.0) (2024-08-06)


### Features

* add postBody Functionality ([0c9d7dc](https://github.com/cdloh/cloudflare-esi/commit/0c9d7dce6ce7e9e4c0372cc640d45efb0d7c8bc8))

## [0.2.5](https://github.com/cdloh/cloudflare-esi/compare/v0.2.4...v0.2.5) (2024-06-18)


### Bug Fixes

* handle int conditions better ([0cd89fe](https://github.com/cdloh/cloudflare-esi/commit/0cd89feee6f1f0ab4ef3ab45918803fd8188c791))

## [0.2.4](https://github.com/cdloh/cloudflare-esi/compare/v0.2.3...v0.2.4) (2024-06-18)


### Bug Fixes

* handle empty strings correctly (dont force them to be ints) ([eb61116](https://github.com/cdloh/cloudflare-esi/commit/eb61116a9a0f24c8fe778c9c83df70136d0ffce1))

## [0.2.3](https://github.com/cdloh/cloudflare-esi/compare/v0.2.2...v0.2.3) (2024-06-11)


### Bug Fixes

* handles esi Args that are strings but have leading integers ([1aa0067](https://github.com/cdloh/cloudflare-esi/commit/1aa006710636e72ae6a9f52fc1f5dba7fbfee29d))
* update actions and nodejs versions to fix for latest LTS ([9bd3ab4](https://github.com/cdloh/cloudflare-esi/commit/9bd3ab4b47b973663b42f5363da087d328fea79b))
* Upgrade packages prep for a few patches ([060c874](https://github.com/cdloh/cloudflare-esi/commit/060c8744942a0ece2635d5d51cc22c497952918a))

## [0.2.2](https://github.com/cdloh/cloudflare-esi/compare/v0.2.1...v0.2.2) (2022-10-12)


### Bug Fixes

* Multiple ESI args passed as query params ([4860b9d](https://github.com/cdloh/cloudflare-esi/commit/4860b9df56d4965d0bfeee9a5a6c8be112b5548a))

## [0.2.1](https://github.com/cdloh/cloudflare-esi/compare/v0.2.0...v0.2.1) (2022-09-12)


### Bug Fixes

* Fix unit tests after miniflare upgrade ([3ae8456](https://github.com/cdloh/cloudflare-esi/commit/3ae84569da9a93978d891277aacf409e551d6542))

# [0.2.0](https://github.com/cdloh/cloudflare-esi/compare/v0.1.2...v0.2.0) (2022-08-23)


### Features

* Commit for first release ([2c9b961](https://github.com/cdloh/cloudflare-esi/commit/2c9b9614c1809e0592052072f2563589b93751d9))
