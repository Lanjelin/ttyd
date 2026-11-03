# Modernization history and recorded evidence

This is a historical record of the 2026-11-02 modernization audit and later
follow-ups, not a new certification of the current checkout. Commands, versions,
artifact paths and audit results below describe the work recorded at that time.
In particular, `build/ttyd.alpine.x86_64` is a historical local artifact path,
not the current cross-build output contract. Current guidance is in
[the baseline](../MODERNIZATION.md), [building](building.md), and
[releasing](releasing.md). The 1.8.0 hosted failures and outstanding limits below
remain recorded failures/limits; local fixes do not establish hosted success.

Audit date: 2026-11-02. Scope: maintainable dependency/build baseline for
[Lanjelin/ttyd-ng](https://github.com/Lanjelin/ttyd-ng), preserving the terminal protocol
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
| Publishing | Hardcoded upstream image namespace | Versioned GHCR images only; GitHub releases remain drafts |
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
  (plus `-alpine` for Alpine). Branch-driven `latest`/`alpine` aliases are no
  longer generated.
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

Inspected [run 41443189974](https://github.com/Lanjelin/ttyd-ng/actions/runs/41443189974)
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
  succeeded, creating the public 1.8.0 image in the fork's pre-rename GHCR namespace; Alpine
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

## Repository organization and build isolation — 2026-11-03

- Kept the C/frontend source layout intact. Separated recommended native output
  (`build/native`) from cross outputs (`build/cross/<requested-target>`), retaining
  requested aliases and avoiding deletion of the shared root build directory.
  Updated workflow upload/container consumers and moved release staging to
  `artifacts/` and `release-assets/` without changing published asset names.
- Split current baseline/risks, build guidance, release procedures and historical
  evidence into linked documents. README now prioritizes installation/use and
  distinguishes upstream/distribution packages from this fork's builds.
  The manual is the detailed CLI reference rather than a duplicated README list.
- Added `scripts/check-options.py`, invoked by native release CI, comparing real
  `--help` long names/short aliases with manual source and generated man page.
  Known libwebsockets-dependent options may be absent from runtime help; prose,
  argument semantics and defaults remain review responsibilities.
- Verification: native Release configure/build passed. Full static musl builds
  passed for requested targets `amd64` (invoked outside the checkout from `/tmp`)
  and `x86_64`. Native and prior amd64 executable SHA256 values were unchanged
  after the second cross build; the legacy root `build/ttyd` also survived.
  Both resulting cross executables were identified as statically linked.
- Both amd64 container variants built from the new binary staging path. Native,
  Alpine and Ubuntu HTTP index/token endpoints and browser shell input/output
  round trips passed. Alpine DOM rendering was checked visually. Headless WebGL
  screenshots were blank despite working terminal buffers/input, so this run
  does not certify WebGL visual output; no renderer code was changed.
- Shell syntax and actionlint passed. The actual release-packaging shell produced
  all 14 expected names and verified SHA256 checksums from isolated fixture
  artifacts. Parsed workflows retained only new-tag triggers and reusable
  workflows, with native/container success still gating the draft release.
- CLI consistency passed against native (30 built/31 documented) and static
  (31/31) help, including IPv6's conditional absence. Throwaway smoke cases
  rejected missing/stale options, alias mismatch, duplicates and stale generated
  definitions; actual checker processes returned failure on documentation drift
  and executable failure. The man page was regenerated and local documentation
  paths/anchors checked.
- Limits: no hosted release, publication, non-x86/Windows build or snap
  installation was performed for this reorganization. No frontend sources or
  bundled assets changed; frontend builds and transfer/sixel checks were not
  repeated. Historical checks above retain their original scope and limits.

## Fork naming transition — 2026-11-03

- The project/repository and installable image/package identities are `ttyd-ng`;
  the binary, CLI, CMake target, installed executable and manual remain `ttyd`.
  Publishing derives `ghcr.io/<lowercase-owner>/ttyd-ng` independently of the
  repository basename, retaining exact version and `-alpine` tags. Container
  metadata and current fork links use the renamed project. Upstream attribution
  remains intact, and the earlier publication record still describes the
  pre-rename namespace rather than claiming a retroactive rename.
- At the naming transition, Snap was the only package recipe present and was
  renamed `ttyd-ng`, retaining its `ttyd` app and `usr/bin/ttyd` command. Snap has
  no deb/rpm-style `Conflicts`/`Provides` fields. The qualified command and optional
  manual alias were documented at that time; automatic conflict enforcement or
  Store aliases were not claimed. The recipe and guidance were subsequently
  removed as recorded below.
- Verification: pinned Yarn immutable install, frontend checks/build, native
  Release configure/build and an amd64 musl executable rebuild passed. Native
  CLI consistency passed. Real temporary native/static installations produced
  `bin/ttyd` and `share/man/man1/ttyd.1`, not `bin/ttyd-ng`, and ran `--version`;
  native installation used the matching custom-prefix runtime library path.
- Both renamed amd64 container variants built locally and ran `ttyd --version`
  through their existing entrypoints. Image metadata named ttyd-ng and retained
  default command `ttyd -W bash`; container help used the renamed fork URL.
  The actual tag shell passed old/new repository-basename and mixed-case-owner
  cases. Shell syntax and actionlint passed. A non-README reference scan found
  no stale old image/fork URL references, and local documentation links passed.
- Parsed Snap YAML retained the executable/part contract without unsupported
  conflict/provision keys. All three README checksums were unchanged. No repo
  settings, credentials, releases or remote image publications were changed.
- Limits: Snapcraft and snap are unavailable locally, so snap pack/install and
  alias behavior were not exercised. Windows and non-amd64 builds were not
  repeated; the image checks do not certify those environments.

## Snap packaging removal — 2026-11-03

- Removed the unused `snap/` recipe because this fork is not distributing or
  validating Snap packages. Removed current installation/alias instructions,
  support claims, release checklist requirements and contributor references.
- Native binaries, release downloads and container packaging are unaffected.
  Earlier Snap mentions in this document remain historical evidence, not current
  support or installation guidance.

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

## Linux end-to-end regression suite (2026-11-03)

Added `tests/` with its own pinned Yarn 4.18.1 lockfile, Playwright 1.64.1,
Chromium and `ws` 8.22.1. The suite runs the rebuilt native executable and its
embedded frontend against a raw/noecho Python PTY fixture; no application mock
or frontend development server is involved. The Linux native reusable workflow
now runs the suite and retains failure diagnostics, without adding branch/PR
triggers or changing publication policy.

The first run exposed a native crash: after a valid WebSocket session, an empty
binary message terminated ttyd with `SIGSEGV`. `LWS_CALLBACK_RECEIVE` allocated
zero bytes through `xmalloc(0)` and dereferenced the resulting null buffer.
The approved fix ignores empty messages when no data is buffered and avoids
reallocation/copying for empty continuations while still dispatching buffered
data on an empty final continuation. The same previously failing regression
passed after rebuilding; authenticated fragmented handshakes and input also
passed with empty first, intermediate and final fragments.

The integrated run passed all 16 tests locally; the final repeatability run passed
32/32 executions (`--repeat-each=2`), using two workers and no retries. The host
was Linux x86-64, Node 26.13.0, Python 3.12 and the locally linked libwebsockets
4.5.7, using the Playwright
Chromium build. Native CMake configure/build, the immutable test-package install,
CLI/manual consistency (30 built options, 31 documented), and actionlint 1.7.11
workflow validation also passed. A separate real-browser smoke visibly rendered
keyboard input and its `/usr/bin/cat` response on loopback.

Two initial test-harness failures were corrected rather than changing server
behavior: the disconnect test now observes actual child reaping instead of
expecting Playwright socket events after page destruction; the immediate-exit
test disables reconnect so it observes exactly one fixture session. On this
libwebsockets build, child exit status zero was observed as browser close code
1006. Output-before-close passed, but normal-close signaling and reconnect
policy are not certified by that test.

No Windows, macOS, other-browser, TLS/mTLS, clipboard, SIXEL, transfer,
cross-target, container or hosted-release execution is claimed. See
[the test guide](../tests/README.md) for commands, isolation and coverage limits.

