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
| zlib cross-build | 1.3.2 | Retained |
| json-c cross-build | 0.18 | 0.19, including CMake 4 support |
| OpenSSL cross-build | 3.6.1 and downloaded MinGW patch | 3.5.9 LTS; fix already included, external patch removed |
| libuv cross-build | 1.52.1 | 1.53.0 |
| libwebsockets cross-build | 4.5.7 and config-file patch | 4.5.8 maintenance release; config patch replaced by target selection |
| Containers | Ubuntu 24.04; floating Alpine | Ubuntu retained; Alpine pinned to supported 3.24 |
| Snap | core20, old runtime package names, upstream source checkout | core24, current package names/libuv event plugin, local fork checkout, craftctl |
| CI | Frontend path filters missed nested source; no native HTTP smoke | Recursive frontend/CMake filters, native build + HTTP smoke, release write permission |
| Publishing | Hardcoded upstream image namespace | Lowercase fork GHCR namespace; Docker Hub optional via configured secrets |
| Contributor docs | Outdated frontend and manual tooling instructions | AGENTS.md, current build guidance, pinned go-md2man v2 install |

### Compatibility changes

- Rebuilding the browser client now requires Node >=24 and the pinned Yarn.
  The distributed C executable still has no Node runtime dependency.
- xterm 6 no longer provides the canvas renderer. Replace
  `-t rendererType=canvas` with `-t rendererType=dom`, or omit the setting for
  WebGL with DOM fallback. Do not treat the removed renderer as a supported alias.
- Renderer transitions refit the terminal: a real WebGL context-loss smoke
  exposed an 861px DOM grid in an 800px viewport until fitting was repeated.
- OpenSSL's numerical version decreased intentionally: 3.6 support ended on
  2026-11-01, whereas 3.5 LTS is supported through April 2030. A larger version
  number is not necessarily a better maintenance baseline.
- Native library floors are not raised just to match cross-build pins. System
  builds can use distribution-maintained libraries; libwebsockets must include
  libuv support. The cross-build pins describe bundled release binaries, not
  the oldest distribution packages accepted by CMake.
- Snap packaging now builds the current checkout instead of fetching upstream.
- The Docker workflow publishes to the fork's GHCR namespace. Docker Hub needs
  `DOCKER_HUB_USER` and `DOCKER_HUB_TOKEN`; no upstream credentials are assumed.
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
- `actionlint` workflow validation, `bash -n scripts/cross-build.sh`, main/tag
  image-tag generation with and without Docker Hub, and man-page regeneration
  with go-md2man 2.0.7 passed.

Not certified here: Windows/non-x86 targets, installed snap (Snapcraft is not
available locally), clipboard integration and ZMODEM transfers. A trzsz
download attempt reached the browser file-picker flow but was cancelled under
headless automation; successful end-to-end transfer is not claimed. No
publishing was performed. These are release-validation limits, not hidden
claims of platform coverage.

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
