# Current modernization baseline

[ttyd-ng](https://github.com/Lanjelin/ttyd-ng), maintained by Lanjelin, is a fork
of [tsl0922/ttyd](https://github.com/tsl0922/ttyd). It preserves upstream
attribution, license, terminal protocol and security defaults. This document
records current maintenance decisions, not certification of every platform.

- [Build and contributor guidance](docs/building.md)
- [Release procedures and checklist](docs/releasing.md)
- [Historical audit, verification, release incident and font evidence](docs/history.md)

## Naming and packaging

The fork's project and container image identities are `ttyd-ng`;
its image is `ghcr.io/lanjelin/ttyd-ng`, with exact version tags only. The
executable, CLI, CMake project/target, installed paths and manual remain `ttyd`.
Upstream and distribution packages named `ttyd` are not this fork.

No distribution or Homebrew package recipes are maintained in this repository.

## Maintained baseline

| Area | Decision |
| --- | --- |
| Frontend tooling | Node >=24, pinned Yarn 4.18.1 and immutable installs; webpack with Node-based asset generation and flat ESLint configuration |
| Browser terminal | xterm 6 compatible addons; WebGL with DOM fallback; canvas renderer removed |
| Native build | CMake >=3.12, policies through 4.0, C99; exported libwebsockets targets and custom-prefix support |
| Cross dependencies | zlib 1.3.2 from the official GitHub release asset, json-c 0.19, libuv 1.53.0, OpenSSL 3.5.9 LTS, libwebsockets 4.5.8 |
| Cross isolation | Target-only pkg-config metadata, including staged `lib64`; dependency roots retain their existing meanings |
| Windows | Complete upstream libuv system-library linkage, including synchronization; static vcpkg builds use matching static CRT |
| Packaging | Ubuntu 24.04 and Alpine 3.24 container images |
| Automation | New-tag-only orchestration; frontend gates native/container jobs; both gate a draft GitHub release; exact-version GHCR images only |
| Documentation | Manual is the detailed CLI reference; native CI checks option names/aliases against runtime help and generated man page; building, releasing and historical evidence have separate guides |
| Regression coverage | Linux Playwright browser and direct HTTP/WebSocket tests against the rebuilt executable, embedded UI and controlled PTY child; native release job gates on the suite |

Native builds are recommended in `build/native` (`build/native/Release/ttyd.exe`
for MSVC). Cross executables use `build/cross/<requested BUILD_TARGET>/ttyd`
(`ttyd.exe` for win32), preserving aliases such as `amd64` and `ppc64le`.
These output directories do not redefine `CROSS_ROOT`, `STAGE_ROOT` or
`BUILD_ROOT`. See the building guide for commands and dependency requirements.
Cross invocation replaces only its selected ttyd build tree; it no longer
deletes the shared root `build/`. Existing consumers of `build/ttyd` must use
the new native or requested-target path. Release asset names remain unchanged.

## Compatibility and behavior

- Rebuilding the browser client requires Node >=24 and the pinned Yarn; the C
  executable has no Node runtime dependency. System library minimums are not
  raised just to match bundled cross-build pins. Distribution-maintained native
  libraries remain usable; libwebsockets must include libuv support.
- Empty WebSocket messages no longer dereference a null receive buffer.
  Empty continuation frames preserve accumulated data and a final continuation
  still completes the message; authenticated fragmentation is regression-tested.
- Replace `-t rendererType=canvas` with `-t rendererType=dom`, or omit it for
  WebGL with DOM fallback. Canvas is not a supported alias. Renderer/container
  changes and font metrics trigger refitting; terminal edges use the theme
  background. xterm 6's active scrollbar is `.xterm-scrollable-element`, not the
  obsolete `.xterm-viewport`, whose native scrolling is disabled.
- OpenSSL 3.5 LTS was selected intentionally over 3.6: 3.6 support ended on
  2026-11-01; 3.5 LTS is supported through April 2030. A larger version is not
  necessarily a better maintenance baseline.
- Long-only `--font` accepts one readable regular local `.woff2`, `.woff`,
  `.ttf` or `.otf` file, or an HTTP(S) font-file URL. Local bytes remain outside
  the executable and are served only through the authenticated, base-path-aware
  exact `/font` route; no directory is exposed. Token JSON supplies the URL.
  Remote URLs are fetched directly by the browser, not proxied by ttyd.
- The bundled client loads/registers the font before opening xterm and retains
  its internal alias across reconnects. A loaded font overrides `fontFamily`;
  size/weight controls remain independent. Failure warns in the browser console
  and preserves fallback. Custom index pages must implement loading themselves.
  Only one regular face is configured, not separate bold/italic mappings.
  Remote fonts depend on client connectivity, availability, CORS, HTTPS/mixed
  content rules and deployed CSP; they are not universally deployable.
- Only new tag pushes start automation, not branch pushes, pull requests, tag
  moves or deletions. Tags must match the CMake version, optionally prefixed by
  `v`. GitHub releases remain drafts and existing releases are not updated.
  No branch-driven `latest`/`alpine` aliases are used.
  Distribution packages and upstream releases remain separate from this fork.

## Open risks and deliberately retained limits

- Cross builds still use the 2021-11-23 musl/MinGW toolchain release, recorded as
  upstream's latest published release at audit time. Downloads lack a checked-in
  cryptographic checksum manifest. Reproducible toolchain builds, verified
  source/toolchain digests and an explicit runnable target matrix are needed
  before calling the supply chain hardened.
- libwebsockets 5 and OpenSSL 4 migrations require ABI/platform/TLS coverage;
  maintained 4.5/3.5 lines are retained. TypeScript remains 6.0.3 because
  typescript-eslint's supported peer range excludes TypeScript 7. Exact direct
  pins and the refreshed transitive lockfile avoid the old tooling baseline.
- Patched `zmodem.js` remains technical debt, not silently removed functionality.
  Replacement requires real bidirectional transfer and cancellation coverage.
- Windows/MSVC and non-x86 hardware require validation in their actual
  environments. Historical local successes do not certify these paths or
  clipboard/transfer integration. Font evidence specifically does not certify
  every format, public CDN/HTTPS/CSP deployment or packaging target; see the
  detailed historical limits.
- The recorded audit reported development-only ESLint `minimatch@10.2.6`
  [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
  Its fix, 11.0.1, is outside ESLint 10.14.0's declared range. Upgrade ESLint
  when it adopts the fix; do not suppress the advisory or force an unverified
  major override, and avoid untrusted lint glob configuration. The recorded
  production-only audit reported no suggestions; that is not a fresh audit.
- The 1.8.0 hosted run had Windows, ppc64le and Alpine publication failures.
  Local fixes and limited verification are recorded in history, not proof that
  a later hosted run succeeded. GHCR package access requires explicit attention.
- Linux terminal/protocol regression commands and coverage are documented in
  [the test guide](tests/README.md). They do not certify TLS/mTLS, clipboard,
  SIXEL, transfers, Windows or macOS. Extend behavior-level coverage alongside
  reproduced bugs and changes in those integrations.
  In the locally exercised libwebsockets 4.5.7 build, child exit status zero
  reached the browser as WebSocket close code 1006. Final-output delivery is
  tested with automatic reconnect disabled; normal-close signaling and reconnect
  policy still need dedicated investigation.
