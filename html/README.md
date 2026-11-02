# Browser client

## Prerequisites

Use Node.js 24 or newer and the exact Yarn version declared by `packageManager`
in `package.json`. Node is needed only to develop/rebuild the browser client;
native builds can use the committed `src/html.h`.

Install [Corepack](https://yarnpkg.com/corepack) if your Node installation does
not provide it, then let Corepack select the pinned Yarn version:

```sh
npm install --global corepack
corepack enable
cd html # from the repository root
node --version
yarn --version
yarn install --immutable
```

Do not use Yarn Classic or activate a floating `yarn@stable` in CI. For an
intentional dependency update, use `yarn install` to update `yarn.lock`, then
verify that `yarn install --immutable` succeeds. Keep the local ZMODEM patch in
`.yarn/patches/` until its fix is available upstream.

## Development

1. Build the native server, then run `./build/ttyd -i 127.0.0.1 -W bash` from the
   repository root. `-W` is necessary for keyboard input; read-only is the default.
2. From `html/`, run `yarn start` and open `http://localhost:9000/`.
   The dev server proxies `/token` and `/ws` to port 7681.
3. Run `yarn check` for TypeScript and lint checks. Use `yarn fix` only
   when you intend to apply formatting/lint changes.

## Production assets

```sh
yarn build
```

The production build bundles and inlines HTML/JavaScript/CSS, compresses the
result, and writes `../src/html.h`. Commit the generated header with frontend
source/dependency changes. Rebuild the native binary before testing its bundled
page. `yarn inline` produces `dist/inline.html` without replacing the C header.

xterm.js 6 supports the default WebGL renderer and DOM fallback; the deprecated
canvas addon is no longer shipped. Change `-t rendererType=canvas` deployments
to `-t rendererType=dom` (or omit it to use WebGL).

Verify the actual terminal in a browser after dependency upgrades: output,
keyboard input, resizing, reconnect/disconnect, and DOM fallback. File transfer,
clipboard and image support need their own scenario checks; a successful
webpack build does not verify them.
