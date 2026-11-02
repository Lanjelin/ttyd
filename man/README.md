# Building the man page

```bash
go install github.com/cpuguy83/go-md2man/v2@v2.0.7
go-md2man < ttyd.man.md  > ttyd.1
```