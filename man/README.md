# Building the man page

`ttyd.man.md` is the authoritative detailed CLI/client-option reference.
`ttyd.1` is generated; do not edit it directly. From this directory:

```bash
go install github.com/cpuguy83/go-md2man/v2@v2.0.7
go-md2man < ttyd.man.md  > ttyd.1
```

After changing CLI options, update native `--help` and `ttyd.man.md` together,
regenerate `ttyd.1`, rebuild the native executable, then check from the repository
root:

```sh
python3 scripts/check-options.py build/native/ttyd
```

The check covers long names and short aliases, including generated-manual
consistency. It allows known build-conditional options to be absent from runtime
help; prose, argument semantics and defaults still require review. See the
[build guide](../docs/building.md#cli-reference-and-manual).