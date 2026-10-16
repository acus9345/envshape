# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-16

### Added

- `parseEnv(schema, options)` validates environment variables and returns a frozen, fully typed object.
- Validators: `str`, `num`, `bool`, `url`, `port`, `oneOf`, `list` and `json`, with `default`, `optional`, `desc`, `example` and `secret` options.
- `EnvError` lists every missing or invalid variable at once, each with a suggested fix.
- Values of secret-looking variables are hidden in errors, and credentials inside URLs are masked.
- `exitOnError` option prints problems and exits with code 1 instead of throwing.
- `envshape check <schema.json> [--env-file .env]` CLI with `--help`, `--version` and `--quiet`.

[0.1.0]: https://github.com/acus9345/envshape/releases/tag/v0.1.0
