# End-to-end regression tests

These tests launch the real `ttyd` executable and exercise its embedded browser
client, HTTP/WebSocket endpoints, and POSIX PTY. They do not use a mocked server
or the webpack development server. Linux is the supported test host; Windows,
macOS, other browsers, TLS deployments, clipboard permissions, SIXEL and file
transfers require separate validation.

## Run

From the repository root, build the current checkout first:

```sh
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --parallel
cd tests
npx --yes @yarnpkg/cli-dist@4.18.1 install --immutable
npx --yes @yarnpkg/cli-dist@4.18.1 exec playwright install chromium
npx --yes @yarnpkg/cli-dist@4.18.1 test
```

Requirements: the native build prerequisites in [the building guide](../docs/building.md),
Node >=24, Python 3, and Chromium's runtime libraries. On supported Debian/Ubuntu
hosts, use `playwright install --with-deps chromium` in the install command above
to install browser system dependencies too. That command may require sudo.
The pinned Yarn invocation avoids relying on a global Yarn Classic or Corepack.
The test package and lockfile are independent of the frontend package; adding
or running tests does not regenerate `src/html.h`.

The committed embedded frontend is sufficient for native-only changes. If
browser sources changed, run the pinned frontend install/check/build first,
then rebuild the native executable so the tests exercise the changed bundle.

To select a different freshly built executable, set `TTYD_BINARY` to its absolute
path. `PYTHON` can select the Python 3 executable used for the controlled child.
The default executable is `build/native/ttyd`, independent of the working directory.

```sh
npx --yes @yarnpkg/cli-dist@4.18.1 test:protocol
npx --yes @yarnpkg/cli-dist@4.18.1 test:e2e
npx --yes @yarnpkg/cli-dist@4.18.1 test --grep 'resize'
```

## Assertions and isolation

- Browser tests use real keyboard events and xterm's public buffer API, not
  renderer-specific DOM snapshots. They cover writable round trips, read-only
  defaults, Basic authentication, resize, base paths, disconnect cleanup, final
  output on exit, and operation without WebGL.
- Protocol tests connect directly to the real HTTP/WebSocket endpoints. They
  cover authentication/origin boundaries, read-only enforcement, fragmented
  messages, and malformed-message service survival.
  Empty WebSocket frames are covered both as standalone messages and as initial,
  intermediate and final fragments of authenticated/session payloads.
- Each server binds to `127.0.0.1` on an OS-assigned port and runs only the
  deterministic Python fixture. No test exposes an interactive shell.
- The fixture records observed input, PTY dimensions and lifecycle events in a
  per-server temporary directory. Read-only assertions synchronize on an ordered
  resize event rather than treating a short period of silence as success.
- Assertions have deadlines; tests do not use arbitrary sleeps to wait for
  startup or browser rendering. The runner uses two workers and no retries, so
  an intermittent failure is a failure, not silently retried away.
- Teardown terminates test servers and fixture process groups. Tests must never
  use an existing user terminal session or depend on external network services
  after installing their prerequisites.

The immediate-exit scenario disables automatic reconnect to observe one child
and its final output in isolation. It asserts output-before-close, not a
particular WebSocket close code. On the locally exercised libwebsockets 4.5.7
build, a child exit status of zero was observed by the browser as close code
1006; normal-close signaling and reconnect policy remain separate coverage gaps.

Failures retain Playwright diagnostics in ignored `tests/test-results/`.
Browser failures include a trace and screenshot; server logs aid native crash
and startup diagnosis. To inspect a trace:

```sh
npx --yes @yarnpkg/cli-dist@4.18.1 exec playwright show-trace test-results/<case>/trace.zip
```

The reusable backend workflow runs the suite in its Linux native job and uploads
failure diagnostics. Its caller remains new-tag-only; this does not add branch
or pull-request triggers. Passing locally is not proof that hosted CI, Windows,
macOS, cross-builds or container images work.

Add regressions for reproduced consumer-visible failures, especially boundary,
ordering, cleanup and access-control errors. Do not pin source text, internal
implementation details, or a dependency's private DOM structure.
