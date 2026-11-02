![release](https://github.com/Lanjelin/ttyd/actions/workflows/release.yml/badge.svg)
[![GitHub Releases](https://img.shields.io/github/downloads/Lanjelin/ttyd/total)](https://github.com/Lanjelin/ttyd/releases)
[![Packaging status](https://repology.org/badge/tiny-repos/ttyd.svg)](https://repology.org/project/ttyd/versions)
![GitHub](https://img.shields.io/github/license/Lanjelin/ttyd)

# ttyd - Share your terminal over the web

ttyd is a simple command-line tool for sharing terminal over the web.

This repository is the [Lanjelin/ttyd](https://github.com/Lanjelin/ttyd) fork of
[tsl0922/ttyd](https://github.com/tsl0922/ttyd). Distribution packages and upstream
images may not include this fork's changes. See [MODERNIZATION.md](MODERNIZATION.md)
for dependency decisions and compatibility changes, and [AGENTS.md](AGENTS.md)
for contributor guidance.

![screenshot](https://github.com/tsl0922/ttyd/raw/main/screenshot.gif)

# Features

- Built on top of [libuv](https://libuv.org) and [WebGL2](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API) for speed
- Fully-featured terminal with [CJK](https://en.wikipedia.org/wiki/CJK_characters) and IME support
- [ZMODEM](https://en.wikipedia.org/wiki/ZMODEM) ([lrzsz](https://ohse.de/uwe/software/lrzsz.html)) / [trzsz](https://trzsz.github.io) file transfer support
- [Sixel](https://en.wikipedia.org/wiki/Sixel) image output support ([img2sixel](https://saitoha.github.io/libsixel) / [lsix](https://github.com/hackerb9/lsix))
- SSL support based on [OpenSSL](https://www.openssl.org) / [Mbed TLS](https://github.com/Mbed-TLS/mbedtls)
- Run any custom command with options
- Basic authentication support and many other custom options
- Cross platform: macOS, Linux, FreeBSD/OpenBSD, [OpenWrt](https://openwrt.org), Windows

# Installation

## Install on macOS

- Install with [Homebrew](https://brew.sh): `brew install ttyd`
- Install with [MacPorts](https://www.macports.org): `sudo port install ttyd`

## Install on Linux

- Install on Debian/Ubuntu: `sudo apt install ttyd`
- Install the snap: `sudo snap install ttyd --classic`
- Install on OpenWrt: `opkg install ttyd`
- Install on Gentoo: clone the [repo](https://bitbucket.org/mgpagano/ttyd/src/master) and follow the directions [here](https://wiki.gentoo.org/wiki/Custom_repository#Creating_a_local_repository).
- Install with [Homebrew](https://docs.brew.sh/Homebrew-on-Linux) : `brew install ttyd`
- Precompiled binaries from this fork, when published: [releases](https://github.com/Lanjelin/ttyd/releases)

## Install on Windows

- Binary version: download from this fork's [releases](https://github.com/Lanjelin/ttyd/releases), when available
- Install with [WinGet](https://github.com/microsoft/winget-cli): `winget install tsl0922.ttyd`
- Install with [Scoop](https://scoop.sh/#/apps?q=ttyd&s=2&d=1&o=true): `scoop install ttyd`
- [Compile on Windows](https://github.com/tsl0922/ttyd/wiki/Compile-on-Windows)

## Build from source

Install a C99 compiler, CMake, libuv, json-c, zlib and libwebsockets development
packages. libwebsockets must have libuv support enabled (`-DLWS_WITH_LIBUV=ON`);
its TLS backend may also require OpenSSL development packages. For example, on
Debian/Ubuntu:

```sh
sudo apt install build-essential cmake libuv1-dev libjson-c-dev \
  libwebsockets-dev libssl-dev zlib1g-dev
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
./build/ttyd -i 127.0.0.1 -W bash
```

The committed browser bundle allows native-only builds without Node.js.
For browser changes, use Node.js 24 or newer and the pinned Yarn version;
see [html/README.md](html/README.md). Rebuild the native executable after
regenerating the browser bundle.

## Release automation

Branch pushes (including `main`) and pull requests do not start builds or
publish anything. Only a **new tag push** starts the release workflow; moving
or deleting an existing tag does not start release jobs.

Before tagging, update the version in `CMakeLists.txt` and commit the regenerated
`src/html.h` with any frontend changes. The tag must match that version, either
as `X.Y.Z` or `vX.Y.Z`.

The tag workflow validates the version, checks/builds the frontend, then runs
native builds and container publishing. After both succeed, it creates a
**draft GitHub release** with binaries and checksums. Publish the draft manually
when ready. Existing releases are not updated automatically.

Images are published only to GHCR, using the tag's exact name:

```text
ghcr.io/lanjelin/ttyd:<tag>
ghcr.io/lanjelin/ttyd:<tag>-alpine
```

There are no branch-driven `latest`/`alpine` image tags and no Docker Hub
publishing. GHCR authentication uses GitHub's automatic `GITHUB_TOKEN`; Docker
Hub secrets are not used.

# Usage

## Command-line Options

```
USAGE:
    ttyd [options] <command> [<arguments...>]

OPTIONS:
    -p, --port              Port to listen (default: 7681, use `0` for random port)
    -i, --interface         Network interface to bind (eg: eth0), or UNIX domain socket path (eg: /var/run/ttyd.sock)
    -U, --socket-owner      User owner of the UNIX domain socket file, when enabled (eg: user:group)
    -c, --credential        Credential for basic authentication (format: username:password)
    -H, --auth-header       HTTP Header name for auth proxy, this will configure ttyd to let a HTTP reverse proxy handle authentication
    -u, --uid               User id to run with
    -g, --gid               Group id to run with
    -s, --signal            Signal to send to the command when exit it (default: 1, SIGHUP)
    -w, --cwd               Working directory to be set for the child program
    -a, --url-arg           Allow client to send command line arguments in URL (eg: http://localhost:7681?arg=foo&arg=bar)
    -W, --writable          Allow clients to write to the TTY (readonly by default)
    -t, --client-option     Send option to client (format: key=value), repeat to add more options
    -T, --terminal-type     Terminal type to report, default: xterm-256color
    -O, --check-origin      Do not allow websocket connection from different origin
    -m, --max-clients       Maximum clients to support (default: 0, no limit)
    -o, --once              Accept only one client and exit on disconnection
    -q, --exit-no-conn      Exit on all clients disconnection
    -B, --browser           Open terminal with the default system browser
    -I, --index             Custom index.html path
    -b, --base-path         Expected base path for requests coming from a reverse proxy (eg: /mounted/here, max length: 128)
    -P, --ping-interval     Websocket ping interval(sec) (default: 5)
    -6, --ipv6              Enable IPv6 support
    -S, --ssl               Enable SSL
    -C, --ssl-cert          SSL certificate file path
    -K, --ssl-key           SSL key file path
    -A, --ssl-ca            SSL CA file path for client certificate verification
    -d, --debug             Set log level (default: 7)
    -v, --version           Print the version and exit
    -h, --help              Print this text and exit
```

Read the example usage on the [wiki](https://github.com/tsl0922/ttyd/wiki/Example-Usage).

## Browser Support

Modern browsers, See [Browser Support](https://github.com/xtermjs/xterm.js#browser-support).

## Alternatives

* [Wetty](https://github.com/krishnasrinivas/wetty): [Node](https://nodejs.org) based web terminal (SSH/login)
* [GoTTY](https://github.com/yudai/gotty): [Go](https://golang.org) based web terminal
