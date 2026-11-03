# Building this fork

Run commands from the repository root unless a section says otherwise. Build the
checkout containing the changes you need; upstream packages and older fork
releases do not acquire local changes. No build command here publishes anything.

## Entry points and outputs

| Task | Entry point | Output |
| --- | --- | --- |
| Native C executable | CMake | `build/native/ttyd` (MSVC: `build/native/Release/ttyd.exe`) |
| Browser client | Pinned Yarn in `html/` | `html/dist/` and regenerated `src/html.h` |
| Static musl / MinGW executable | `scripts/cross-build.sh` | `build/cross/<requested-target>/ttyd` (`ttyd.exe` for `win32`) |
| Local container | Root `Dockerfile` or `Dockerfile.alpine` | Local image, consuming `dist/<image-arch>/ttyd` |
| Installed manual | `go-md2man` in `man/` | Regenerated `man/ttyd.1` |

Native and cross builds do not share a CMake build tree. Different requested
cross targets retain separate executable outputs. An existing legacy `build/`
from an older checkout can remain untouched; do not reuse its cache as a new
native/cross cache. The cross script replaces only its selected ttyd target
build directory, plus that target's dependency stage/build directories. It does
not delete the shared `build/` directory.

## Native build

Prerequisites: a C99 compiler, CMake >=3.12, libuv, json-c, zlib and libwebsockets
>=3.2 development files. libwebsockets must include libuv support
(`LWS_WITH_LIBUV=ON`). Install matching OpenSSL development files if that is its
TLS backend. Python 3 is needed for the CLI documentation check, not to run ttyd.

On Debian/Ubuntu:

```sh
sudo apt-get update
sudo apt-get install build-essential cmake libuv1-dev libjson-c-dev \
  libwebsockets-dev libssl-dev zlib1g-dev python3
```

Then:

```sh
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --parallel
./build/native/ttyd --version
python3 scripts/check-options.py build/native/ttyd
./build/native/ttyd -i 127.0.0.1 -W bash
```

Open `http://127.0.0.1:7681/`. Use `/bin/sh` if bash is unavailable. Omit `-W`
for read-only operation. Keep test shells on loopback; remote testing can use
an SSH tunnel rather than exposing a shell on all interfaces.

For libraries installed outside normal system paths, add
`-DCMAKE_PREFIX_PATH=/path/to/prefix` to the configure command. Do not copy a
CMake cache between native and cross builds. Optional installation is
`sudo cmake --install build/native` with CMake >=3.15; on older supported CMake,
use `sudo cmake --build build/native --target install`.

The committed `src/html.h` allows a native build without Node or Yarn. After
changing browser sources, rebuild the browser bundle first, then rebuild CMake's
native executable to incorporate it.

### Windows / MSVC

Use Visual Studio's C++ build tools, CMake, and vcpkg's `x64-windows-static`
triplet with libwebsockets (libuv enabled), libuv, json-c, zlib, OpenSSL and
getopt-win32. Follow the exact dependency and generator configuration in
[the backend workflow](../.github/workflows/backend.yml). Its native build tree
is `build/native`; Release output is `build/native/Release/ttyd.exe`.

The static triplet requires matching static CRT selection (`/MT` for Release,
`/MTd` for Debug). MinGW cross builds below are a separate toolchain, not proof
that MSVC compilation or Windows runtime behavior works.

## Browser client

Use Node.js >=24 and the exact Yarn version in `html/package.json`
(currently 4.18.1), not global Yarn Classic or floating `yarn@stable`.
[The frontend guide](../html/README.md) covers package-manager setup and the
development server.

```sh
cd html
yarn --version # must match packageManager
yarn install --immutable
yarn check
yarn build
cd ..
cmake --build build/native --parallel
```

`yarn build` creates `html/dist/` and regenerates compressed `src/html.h`.
Commit the generated header with browser source changes and the lockfile with
dependency changes. `yarn inline` produces `html/dist/inline.html` without
replacing the header. Check the rebuilt executable's bundled UI, not just the
standalone HTML: output, writable input, resize, disconnect/reconnect and
renderer fallback; transfers and sixel need their own checks when affected.

## Static musl build for Alpine

Use `scripts/cross-build.sh` on an x86-64 Linux build host. It downloads the
cross-toolchain and builds its pinned zlib, json-c, libuv, OpenSSL and
libwebsockets dependencies; distribution development libraries are not used for
the target. Network access and sufficient disk space are required.

Debian/Ubuntu host prerequisites:

```sh
sudo apt-get install autoconf automake build-essential cmake curl file libtool pkg-config perl git
```

Arch host prerequisites:

```sh
sudo pacman -S --needed base-devel cmake curl autoconf automake libtool pkgconf file perl git
```

For Alpine x86-64:

```sh
env BUILD_TARGET=x86_64 \
  CROSS_ROOT="$HOME/.cache/ttyd-cross/toolchain" \
  STAGE_ROOT="$HOME/.cache/ttyd-cross/stage" \
  BUILD_ROOT="$HOME/.cache/ttyd-cross/dependencies" \
  ./scripts/cross-build.sh
file build/cross/x86_64/ttyd
./build/cross/x86_64/ttyd --version
```

Expect a statically linked executable. Copy it to the matching Alpine machine
and run it there, for example with `/bin/sh` instead of bash. A native glibc
executable is not an interchangeable Alpine artifact.

The defaults for `CROSS_ROOT`, `STAGE_ROOT`, and `BUILD_ROOT` are `/opt/cross`,
`/opt/stage`, and `/opt/build`; the user-owned roots above avoid requiring root.
`BUILD_ROOT` controls dependency build trees, **not** the final ttyd output.
The script can be invoked from outside the checkout by its absolute path.

Supported requested targets are `i686`, `x86_64`, `arm`, `armhf`, `armv7l`,
`aarch64`, `mips`, `mipsel`, `mips64`, `mips64el`, `powerpc64`, `powerpc64le`,
`s390x`, and `win32`. Aliases `amd64`, `arm64`, `armv7`, `ppc64`, and `ppc64le`
select the corresponding toolchain while retaining the **requested spelling**
in the output directory. For example:

- `BUILD_TARGET=amd64` → `build/cross/amd64/ttyd`
- `BUILD_TARGET=arm64` → `build/cross/arm64/ttyd`
- `BUILD_TARGET=ppc64le` → `build/cross/ppc64le/ttyd`
- `BUILD_TARGET=win32` → `build/cross/win32/ttyd.exe` (64-bit MinGW, despite the target label)

Only execute a target binary on a compatible OS/architecture or under suitable
emulation. Target-specific success does not certify the entire matrix.
Toolchain age and missing download checksum verification remain documented
[risks](../MODERNIZATION.md); this guide does not claim reproducible builds.

## Local container images

The root Dockerfiles are **packaging-only**: they copy a prebuilt static binary
from `dist/<image-arch>/ttyd`; they do not compile sources or rebuild the frontend.
Build the static binary first. For a single-platform amd64 image, use
`BUILD_TARGET=amd64` with the roots from the previous section, then:

```sh
mkdir -p dist/amd64
cp build/cross/amd64/ttyd dist/amd64/ttyd
docker build --platform linux/amd64 --build-arg TARGETARCH=amd64 \
  -f Dockerfile.alpine -t ttyd-ng-local:alpine .
docker run --rm --platform linux/amd64 -p 127.0.0.1:7681:7681 ttyd-ng-local:alpine
```

Open `http://127.0.0.1:7681/`. The image defaults to `ttyd -W bash`; unlike the
bare CLI default, that is writable. Inside the container ttyd needs to listen on
the container interface; the host port mapping above restricts host exposure to
loopback. For the Ubuntu variant, use `-f Dockerfile -t ttyd-ng-local:ubuntu` and
run that image instead. Neither command pushes an image.

For other platforms, stage the matching target binary: Docker `amd64` uses the
`amd64` target, `arm64` uses `arm64`, `arm` (linux/arm/v7) uses `armv7`, and
`s390x` uses `s390x`. For example, copy `build/cross/armv7/ttyd` to
`dist/arm/ttyd`. Multi-platform execution needs native machines or emulation;
see [the container workflow](../.github/workflows/docker.yml) for the complete
matrix. Building an image alone does not verify terminal behavior.

## CLI reference and manual

[man/ttyd.man.md](../man/ttyd.man.md) is the authoritative detailed option
reference. `ttyd --help` remains the runtime summary for features compiled into
a particular build. The README links to the reference instead of duplicating
its full option list.

After editing options, update native help and the manual together, regenerate
`man/ttyd.1` using [the pinned manual tool](../man/README.md), then run:

```sh
python3 scripts/check-options.py build/native/ttyd
```

The check compares long option names and short aliases between actual `--help`,
the manual's OPTIONS section, and the generated man page. It rejects missing,
stale and duplicate definitions; known build-conditional options (IPv6, TLS,
and ping interval) may be absent from runtime help. It does not compare prose,
argument semantics, or defaults; review those when changing behavior. The native
release job runs this check without adding branch/PR automation.

For release validation, publishing rules and GHCR troubleshooting, use
[the release guide](releasing.md). Historical verification is recorded separately
in [project history](history.md), not implied by these commands.
