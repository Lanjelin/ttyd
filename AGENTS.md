# Working on ttyd-ng

## Project and ownership

This is [Lanjelin/ttyd-ng](https://github.com/Lanjelin/ttyd-ng), a fork of
[tsl0922/ttyd](https://github.com/tsl0922/ttyd). Preserve upstream attribution and
license notices. Do not assume upstream release binaries, distro packages, or
third-party images contain this fork's changes.

The project/repository and installable image/package identities are `ttyd-ng`;
the executable, CLI, CMake target and installed binary path remain `ttyd`.

## Code map

- `src/server.c`, `server.h`: CLI options, server configuration, libuv/libwebsockets lifecycle.
- `src/http.c`: index/token endpoints, HTTP authentication and embedded assets.
- `src/protocol.c`: WebSocket authentication, terminal I/O, resize and flow control.
- `src/pty.c`, `pty.h`: POSIX PTYs and Windows process/terminal handling.
- `src/utils.c`, `compat.h`: utilities and portability.
- `html/src/`: TypeScript/Preact UI, xterm integration and transfer addons.
- `src/html.h`: generated compressed frontend; never hand-edit.
- `CMakeLists.txt`, `cmake/`: native configuration and version detection.
- `scripts/cross-build.sh`: static cross-build dependencies and target mapping.
- `.github/workflows/`, `Dockerfile*`: CI, publishing and container packaging.
- `man/ttyd.man.md`: manual source; `man/ttyd.1` is its generated output.
- `MODERNIZATION.md`: current dependency decisions, compatibility and remaining risks.
- `docs/building.md`, `docs/releasing.md`: build commands and release checklist/procedures.
- `docs/history.md`: historical verification and release incident records.

## Build and development

Native prerequisites: a C99 compiler, CMake, zlib, json-c, libuv and
libwebsockets built with libuv support (`LWS_WITH_LIBUV=ON`). Install the TLS
development libraries matching libwebsockets. See `CMakeLists.txt` for the actual
minimum versions; do not arbitrarily raise distro library floors.

```sh
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --parallel
./build/native/ttyd --version
./build/native/ttyd --help
python3 scripts/check-options.py build/native/ttyd
./build/native/ttyd -i 127.0.0.1 -W bash
```

Use `CMAKE_PREFIX_PATH` for custom library installs. Verify with a browser at
`http://127.0.0.1:7681/`; do not expose a test shell on all interfaces.

Cross builds use `build/cross/<requested BUILD_TARGET>/ttyd` (`ttyd.exe` for
win32), preserving aliases such as amd64. Never delete the shared `build/`
directory or mix native and cross CMake caches. Dependency `BUILD_ROOT` is not
the executable output directory. See `docs/building.md` for all build entry points.

On Windows, static libuv needs its upstream system-library dependencies,
including `synchronization` for `WaitOnAddress`/`WakeByAddressSingle`. Raw
`find_library` does not propagate them. MSVC builds using vcpkg's
`x64-windows-static` triplet must also use the matching static CRT (`/MT` for
Release, `/MTd` for Debug); see the backend workflow's runtime-library setting.

Frontend requirements and commands are in `html/README.md` and
`html/package.json`. Use the package manager version pinned in `packageManager`,
not a global Yarn Classic or floating `yarn@stable`. Install with
`yarn install --immutable`, run `yarn check`, then `yarn build` from `html/`.
A full frontend build regenerates `src/html.h`; rebuild the native executable
before checking the bundled UI. Commit the lockfile and generated header with
frontend dependency/source changes.

## Invariants and conventions

- Preserve the WebSocket command bytes on both sides (`src/server.h`,
  `src/protocol.c`, and the frontend terminal wrapper). Coordinate protocol
  changes across C and TypeScript.
- Preserve read-only-by-default behavior, authentication, origin checks,
  base-path handling, disconnect cleanup and backpressure.
- Keep POSIX and Windows code paths working; document platform-specific limits.
- Native formatting follows `.clang-format`: Google style, two spaces,
  120-column limit. Frontend follows its checked-in lint/format configuration.
  Avoid unrelated reformatting.
- Reuse existing ownership/disposal patterns for libuv handles, PTY buffers,
  WebSockets and xterm addons. Disconnects and failed startup must release them.
- Dependency upgrades must be a compatible set, particularly xterm and its
  addons. Preserve local Yarn patches until the underlying fix is available.
- Do not add new CLI/client options without updating the help, manual, and
  relevant README examples together.

## Verification and delivery

There is no established general-purpose application test suite. Compilation and
linting alone do not demonstrate terminal behavior. For affected paths, run the
real executable and exercise HTTP plus a browser/WebSocket session: output,
keyboard input with `-W`, resize, disconnect, and renderer fallback. Check
read-only mode and authentication when touching those paths. Exercise file
transfers and sixel when changing their integrations; explicitly report anything
not exercised.

Run frontend checks/builds for frontend changes, and a native configure/build
for C or generated-header changes. Validate shell scripts and workflow syntax
when changing automation. Cross-target CI, Windows and containers require their
own environments; do not claim local Linux checks prove them.

Automation is intentionally new-tag-only. `release.yml` validates the version,
runs the reusable frontend workflow, then native builds and GHCR publishing;
both must succeed before creating a draft release. Branch/PR pushes do not build
or publish. Keep this trigger policy when editing CI.

Keep changes focused. Update current compatibility/risks in `MODERNIZATION.md`,
release procedures in `docs/releasing.md`, and historical verification evidence
in `docs/history.md`; never describe an untested release path as verified. The
manual is the authoritative detailed CLI reference; update native help and
`man/ttyd.man.md` together, regenerate `man/ttyd.1`, and run the CLI consistency
checker. Do not publish releases/images or alter credentials as part of local
development without an explicit request.
