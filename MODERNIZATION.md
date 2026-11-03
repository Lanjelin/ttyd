# Modernization audit and release plan

Audit date: 2026-11-02. Scope: maintainable dependency/build baseline for
[Lanjelin/ttyd](https://github.com/Lanjelin/ttyd), preserving the terminal protocol
and existing security defaults. This is not a new release or a claim that all
supported platforms have been certified.

## Decisions implemented

| Area | Previous state | New baseline / decision |
| --- | --- | --- |
| Frontend Node | Manifest allowed Node 12; CI used EOL Node 18 | Node 24 minimum and CI baseline; native-only builds do not require Node |
| Package manager | Yarn 3.6.3; README demanded v2; CI activated floating stable | Pin Yarn 4.18.1; immutable lockfile install |
| Browser terminal | xterm 5.5 and canvas addon | xterm 6 compatible addon set; WebGL with DOM fallback; canvas removed |
| Frontend build | Gulp 4, stream plugins, legacy lint integration | webpack retained; Node-based asset generation; current flat ESLint configuration |
| CMake | Dead pre-3.1 branch despite 3.12 minimum | Retain 3.12 minimum, policies through 4.0, normal C99 selection |
| libwebsockets discovery | Raw library names outside MSVC | Select exported targets on all platforms; custom-prefix linking fixed |
| Cross pkg-config | Only staged `lib` searched; host metadata could leak in | Isolated target `PKG_CONFIG_LIBDIR`, including staged `lib64` for OpenSSL |
| zlib cross-build | 1.3.2 from zlib.net | Retain 1.3.2; use the official GitHub release asset after an invalid archive response |
| json-c cross-build | 0.18 | 0.19, including CMake 4 support |
| OpenSSL cross-build | 3.6.1 and downloaded MinGW patch | 3.5.9 LTS; fix already included, external patch removed |
| libuv cross-build | 1.52.1 | 1.53.0 |
| Windows static linking | Raw libuv archive without complete system linkage; MSVC dynamic CRT default | Restore upstream libuv system libraries, including synchronization; match vcpkg's static CRT |
| libwebsockets cross-build | 4.5.7 and config-file patch | 4.5.8 maintenance release; config patch replaced by target selection |
| Containers | Ubuntu 24.04; floating Alpine | Ubuntu retained; Alpine pinned to supported 3.24 |
| Snap | core20, old runtime package names, upstream source checkout | core24, current package names/libuv event plugin, local fork checkout, craftctl |
| CI | Branch/PR builds and independent publishing | New-tag-only orchestration; frontend checks gate native/container builds; release waits for both |
| Publishing | Hardcoded upstream image namespace | Versioned GHCR images only; Docker Hub removed; GitHub releases remain drafts |
| Contributor docs | Outdated frontend and manual tooling instructions | AGENTS.md, current build guidance, pinned go-md2man v2 install |

### Compatibility changes

- Rebuilding the browser client now requires Node >=24 and the pinned Yarn.
  The distributed C executable still has no Node runtime dependency.
- xterm 6 no longer provides the canvas renderer. Replace
  `-t rendererType=canvas` with `-t rendererType=dom`, or omit the setting for
  WebGL with DOM fallback. Do not treat the removed renderer as a supported alias.
- Renderer transitions refit the terminal: a real WebGL context-loss smoke
  exposed an 861px DOM grid in an 800px viewport until fitting was repeated.
- Terminal edges now use the configured theme background, including xterm 6's
  legacy viewport and the unused space outside whole character cells. A
  ResizeObserver batches refits after container/renderer size changes; applying
  preferences also refits for line height and letter spacing, not just font size.
- Disable native scrolling on the obsolete `.xterm-viewport`: xterm 6's active
  scrollbar belongs to `.xterm-scrollable-element`. Leaving the old viewport's
  `overflow-y: scroll` enabled can paint a second, light native scrollbar at the
  browser edge behind the active scrollbar.
- OpenSSL's numerical version decreased intentionally: 3.6 support ended on
  2026-11-01, whereas 3.5 LTS is supported through April 2030. A larger version
  number is not necessarily a better maintenance baseline.
- Native library floors are not raised just to match cross-build pins. System
  builds can use distribution-maintained libraries; libwebsockets must include
  libuv support. The cross-build pins describe bundled release binaries, not
  the oldest distribution packages accepted by CMake.
- Snap packaging now builds the current checkout instead of fetching upstream.
- Only newly created tag pushes start automation. Branch pushes (including
  `main`), pull requests, tag moves and tag deletions do not start build or
  publishing jobs. Frontend/backend/container workflows are reusable, called
  only by the tag-triggered release workflow.
- Tags must match the CMake version, with an optional leading `v`. After
  frontend checks succeed, native builds and GHCR publishing run; both must
  succeed before a draft release is created. Existing releases are not updated.
- Container images use the fork's GHCR namespace and the exact version tag
  (plus `-alpine` for Alpine). Docker Hub publishing and its secrets have been
  removed; branch-driven `latest`/`alpine` aliases are no longer generated.
  Distribution packages and upstream releases remain separate from this fork.

## Intentionally retained / follow-on work

1. **Cross toolchain provenance.** The static matrix still downloads the
   2021-11-23 musl/MinGW toolchains; this remains upstream's latest published
   toolchain release. Replacing compiler/libc stacks across all architectures
   needs an explicit target/support matrix and runnable artifacts, not a guessed
   URL. Downloads also lack a checked-in cryptographic checksum manifest.
   Establish reproducible toolchain builds and verify source/toolchain digests
   before calling the release supply chain hardened.
2. **Major native library migrations.** libwebsockets 5 and OpenSSL 4 are not
   required for this update. Keep the maintained 4.5/3.5 lines until their ABI,
   platform and TLS behavior can be exercised across the supported matrix.
   TypeScript remains 6.0.3 because typescript-eslint's supported peer range
   excludes TypeScript 7. Exact direct dependency pins and a refreshed transitive
   lockfile avoid inheriting the old lockfile's vulnerable tooling versions.
3. **Legacy transfer dependencies.** The patched `zmodem.js` integration is
   retained rather than silently removing file transfer. Treat its maintenance
   status as technical debt; evaluate a maintained replacement with real
   bidirectional transfer and cancellation coverage before cutover.
4. **Packaging coverage.** Verify Windows/MSVC, MinGW, non-x86 targets and an
   installed classic snap in their actual environments. Snap still consumes the
   external `homeishome-launch` stage-snap. Linux browser success does not prove
   those paths or classic-snap ELF/plugin resolution.
5. **Feature work.** Keep future features separate from dependency maintenance.
   Add behavior-level regression coverage when introducing protocol, terminal
   lifecycle, authentication or file-transfer changes. No feature scope is
   implied by this audit.

### Remaining advisory

The refreshed full dependency audit still reports
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
for ESLint's development-only `minimatch@10.2.6` dependency. The fix is in
minimatch 11.0.1, outside ESLint 10.14.0's declared dependency range. Do not
force an unverified major override or suppress the advisory. Upgrade ESLint
when it adopts the fixed major, and avoid running lint with untrusted glob
configuration. The production-only dependency audit reports no suggestions.

## Release checklist

- Run immutable frontend install, type/lint/format checks, production build,
  and a dependency advisory audit; record any unresolved advisories.
- Rebuild the executable against the regenerated `src/html.h`; exercise the
  actual bundled terminal, WebGL/DOM fallback, keyboard input, resizing,
  disconnect and read-only behavior. Check authentication/base paths if touched.
- Exercise clipboard, sixel and ZMODEM/trzsz transfer scenarios before release;
  compilation alone does not verify them.
- Run the full cross-build matrix, particularly 32-bit, Windows and s390x.
- Build and run both container images from the updated static binaries.
- Pack/install the classic snap and exercise HTTP, WebSocket and TLS.
- Validate workflow syntax and image tags; publishing itself requires explicit
  release intent and configured repository permissions/secrets.

## Verification performed

- Node 24.22.2 / Yarn 4.18.1: immutable install, `yarn check`, `yarn build`,
  and `yarn inline` passed. The generated `src/html.h` was rebuilt into native
  executables, not just inspected as a standalone HTML file.
- Full recursive dependency audit reduced to the single development-only
  advisory above; production-only audit returned no suggestions.
- CMake 4.4.5 / GCC 16.2.1: native shared-library build passed with a custom
  libwebsockets prefix, reproducing then fixing the original missing-library
  link failure. CLI version/help and HTTP index/token endpoints exercised.
- Full x86-64 musl cross-build passed using the updated zlib/json-c/libuv/
  OpenSSL/libwebsockets chain and static-only libwebsockets target. Initial
  host pkg-config contamination was reproduced and fixed; the rebuilt binary
  is statically linked. HTTPS token endpoint passed certificate verification
  with a temporary local CA certificate.
- Actual Chromium terminal: WebGL rendering, input/output, viewport resize,
  deliberate WebGL context loss and correctly sized DOM fallback; sixel image
  rendered visibly. Explicit DOM rendering, HTTP Basic authentication, mounted
  base-path endpoints and read-only input behavior exercised.
- Development server: webpack WebSocket transport connected; proxied terminal
  token/WebSocket traffic and command output worked. Normal shell exit showed
  the reconnect prompt; Enter reconnected and accepted a new command.
  A temporary config changed test ports because local port 7681 was occupied;
  that existing service was not stopped.
- Both amd64 Dockerfiles built with the final generated bundle and updated
  static native dependencies; CLI version and real browser shell round trips
  passed in Alpine 3.24 and Ubuntu 24.04 containers.
- `actionlint` workflow validation, `bash -n scripts/cross-build.sh`, and
  man-page regeneration with go-md2man 2.0.7 passed.
- Rendering correction after Alpine VM feedback: frontend check/build and both
  native rebuilds passed. Browser checks covered matching dark/light backgrounds,
  WebGL/DOM grid fitting, font sizes 13/18/20/24, live line-height/letter-spacing
  changes, container-only resizing and viewport resizing. Grid geometry matched
  FitAddon at pixel ratios 1, 1.25 and 2. Glyph screenshots were checked for
  WebGL at 1 and DOM at 1.25; emulated high-DPI WebGL has a browser backing-store
  measurement mismatch, so its glyph screenshots are not certified. The updated
  static artifact is available locally as `build/ttyd.alpine.x86_64`.
- Right-edge follow-up: frontend checks/build and native rebuilds passed.
  A real 200-line scrollback session confirmed the obsolete viewport reserves
  no native scrollbar width, even with an explicitly white native scrollbar
  style. The active xterm scrollbar remained usable: mouse-wheel scrolling
  moved the viewport and dragging its thumb reached the first output line.
  The rebuilt bundle's edge was checked visually. The supplied Alpine VM LAN
  endpoint refused browser and workstation connections, so verification used
  the rebuilt static binary locally; no commands were sent to the VM terminal.
- Tag-only automation rewrite: `actionlint` passed. Parsed-workflow smoke cases
  allowed release jobs only for a new tag, not main/new-branch pushes, pull
  requests, tag moves or tag deletions. The actual version-check shell accepted
  matching bare/`v` tags and rejected mismatches; the actual image-metadata shell
  emitted only the two versioned GHCR image names. No GitHub release or image
  publication was performed during these checks.
  The release-packaging shell also correctly named 14 fixture assets and
  generated verified SHA256 checksums in an isolated, source-free workspace.

Not certified here: MSVC builds/native Windows execution, non-x86 hardware,
installed snap (Snapcraft is not available locally), clipboard integration and
ZMODEM transfers. A trzsz download attempt reached the browser file-picker flow
but was cancelled under headless automation; successful end-to-end transfer is
not claimed. Local verification did not publish images or releases. These are
release-validation limits, not hidden claims of platform coverage.

## First hosted release run: 1.8.0

Inspected [run 41443189974](https://github.com/Lanjelin/ttyd/actions/runs/41443189974)
without rerunning jobs or changing remote state.

- **MSVC and win32:** static libuv introduced `WaitOnAddress` and
  `WakeByAddressSingle` references, but raw library discovery omitted their
  system-library dependencies. Restored the Windows system-library list from
  upstream libuv, including `synchronization`. MSVC also emitted a `LIBCMT`
  runtime mismatch; the static vcpkg job now selects `/MT` (Release) and `/MTd`
  (Debug), rather than suppressing that warning.
- **ppc64le:** failed while unpacking zlib, before compilation, because the
  zlib.net response was not gzip data. Switched to zlib's official GitHub
  release asset. Its downloaded SHA256 matched the upstream release metadata.
- **Verification:** complete win32 and ppc64le cross-builds passed locally.
  The Windows PE executable imports both previously unresolved symbols from
  the Windows synchronization API set. The PowerPC binary ran under QEMU
  10.2.3, served HTTP index/token requests, and completed a WebSocket PTY command
  round trip. Linux configure/build/CLI, shell syntax and actionlint passed.
  Initial local cross-build attempts hit temporary disk quota; owned obsolete
  build trees were cleared and the complete checks then passed sequentially.
  MSVC compilation/runtime still needs a hosted Windows run.
- **Docker:** all four architectures built for both variants. Ubuntu publication
  succeeded, creating the public `ghcr.io/lanjelin/ttyd:1.8.0` image; Alpine
  publication failed with `permission_denied: write_package`. The job token
  already had `packages: write`, and package metadata links it to this fork.
  Effective inherited permissions and Manage Actions access grants are not
  exposed by the available package APIs. Check repository **Write** access in
  the package settings; if already correct, the creation-versus-subsequent-push
  authorization discrepancy remains unexplained. No speculative Docker
  configuration or credential changes were made.

Rerunning the old tag's jobs uses its original commit, not these local fixes.
Commit fixes and select a new matching patch version/tag for the next attempt;
prefer that over moving `1.8.0`, since its Ubuntu image is already public.

## External terminal font loading

- Added long-only `--font` for one readable regular local `.woff2`, `.woff`,
  `.ttf`, or `.otf` file, or an HTTP(S) font-file URL. No font bytes are embedded
  in the executable and no new runtime dependency is required.
- Local fonts use an exact authenticated `/font` route under the configured
  base path; no directory is exposed. Token JSON carries the browser-facing
  font URL. Remote fonts are fetched directly by the browser, never by ttyd.
- The bundled client awaits font loading/registration before opening xterm,
  automatically selects an internal alias, and preserves it across reconnects.
  Failed loads warn in the browser console and retain font-family fallback.
  A loaded `--font` overrides `fontFamily` preferences; size/weight controls
  remain independent. Custom index pages must implement loading separately.
- Remote deployments still depend on client connectivity, CDN availability,
  CORS, HTTPS/mixed-content rules, and deployed CSP. Only one regular face is
  configured; separate bold/italic face mapping is not implemented.
- Verification: pinned Yarn 4.18.1 immutable install, TypeScript/ESLint check,
  production frontend generation, and native Release configure/build passed.
  Actual bundled Chromium sessions loaded an external TTF before terminal
  creation, exercised authenticated base-path serving, automatic font selection
  over `fontFamily=serif`, font-size preferences, writable input/output, PTY
  resize, reconnect without duplicate font registration/download, and WebGL
  context-loss fallback to a correctly sized DOM terminal. A cross-origin TTF
  loaded directly from a local HTTP font host; read-only input remained blocked.
  A host without CORS produced a visible console warning and a usable DOM
  fallback terminal. HTTP smoke checks covered exact file bytes/content type,
  missing authentication, unknown paths, invalid local inputs, both font/base-path
  option orders, escaped remote URL metadata, and unconfigured token responses.
- Limits: actual font decoding was exercised with TTF, not every supported font
  format. Public CDNs, remote HTTPS/CSP deployments, Windows/cross-target builds,
  containers, and snap were not verified for this feature. Transfers and sixel
  integrations were unchanged and were not exercised.

## Sources

- [Node release lifecycle](https://nodejs.org/en/about/previous-releases)
- [Yarn installation and Corepack](https://yarnpkg.com/corepack)
- [xterm.js releases](https://github.com/xtermjs/xterm.js/releases)
- [json-c 0.19 changes](https://raw.githubusercontent.com/json-c/json-c/json-c-0.19-20260627/ChangeLog)
- [OpenSSL source releases](https://openssl-library.org/source/) and
  [support policy](https://openssl-library.org/policies/releasestrat/)
- [libuv 1.53.0 changes](https://raw.githubusercontent.com/libuv/libuv/v1.53.0/ChangeLog)
- [libwebsockets maintenance changes](https://github.com/warmcat/libwebsockets/compare/v4.5.7...v4.5.8)
- [Cross toolchain releases](https://github.com/tsl0922/musl-toolchains/releases)
- [Alpine support](https://alpinelinux.org/releases/) and
  [Ubuntu lifecycle](https://ubuntu.com/about/release-cycle)
- Ubuntu 24.04 packages: [json-c](https://packages.ubuntu.com/noble/libjson-c5),
  [libwebsockets](https://packages.ubuntu.com/noble/libwebsockets19t64),
  [libuv event plugin](https://packages.ubuntu.com/noble/libwebsockets-evlib-uv)
