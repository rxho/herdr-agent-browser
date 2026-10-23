# Third-party notices

This project depends on external open-source software. Its source license applies to original files in this repository; it does not supersede the licenses of dependencies.

## Browser user interface

- Package: [`@agent-infra/browser-ui`](https://www.npmjs.com/package/@agent-infra/browser-ui)
- Source: [`web-infra-dev/agent-browser-sdk`](https://github.com/web-infra-dev/agent-browser-sdk)
- Version: `0.2.2` (pinned in `package-lock.json`)
- Upstream license: Apache License, Version 2.0 (see [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt))

The build uses the upstream distribution bundle. It copies the upstream bundle's generated notices into `public/sdk.js.LICENSE.txt` alongside `public/sdk.js`. That notice file also identifies separately licensed transitive code included in the bundle.

## Browser binary management

- Package: [`@puppeteer/browsers`](https://www.npmjs.com/package/@puppeteer/browsers)
- Source: [`puppeteer/puppeteer`](https://github.com/puppeteer/puppeteer)
- Version: `2.10.13` (locked in `package-lock.json`)
- License: Apache License, Version 2.0

The optional browser installation action fetches Google's separately distributed Chrome for Testing binaries. A downloaded browser is not part of this repository's source tree or npm dependency bundle.

For dependency upgrades, review the upstream distributions and their notices before publication.
