# envshape

Validate environment variables and get a fully typed config object back. Zero dependencies, helpful errors.

[![npm](https://img.shields.io/npm/v/envshape)](https://www.npmjs.com/package/envshape)
[![CI](https://github.com/acus9345/envshape/actions/workflows/ci.yml/badge.svg)](https://github.com/acus9345/envshape/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/envshape)](LICENSE)

- **Typed:** `env.PORT` is a `number`, `env.NODE_ENV` is `"development" | "production" | "test"`. No casts.
- **Every problem at once:** one run lists all missing and invalid variables, each with a fix.
- **Safe errors:** values of variables like `API_KEY` or `DB_PASSWORD` are never printed, and passwords inside URLs are masked.
- **Zero dependencies**, ESM, Node.js 22+. Includes a CLI for CI and Docker entrypoints.

## Install

```bash
npm install envshape
```

## Quick start

Create `app.mjs`:

```js
import { parseEnv, port, url, oneOf, bool } from "envshape";

const env = parseEnv(
  {
    PORT: port({ default: 3000 }),
    DATABASE_URL: url({ example: "postgres://localhost:5432/app" }),
    NODE_ENV: oneOf(["development", "production", "test"], { default: "development" }),
    DEBUG: bool({ default: false }),
  },
  { exitOnError: true },
);

console.log(env);
```

Create `.env`:

```
DATABASE_URL=postgres://localhost:5432/app
DEBUG=true
```

Run it:

```bash
node --env-file=.env app.mjs
```

```
{
  PORT: 3000,
  DATABASE_URL: 'postgres://localhost:5432/app',
  NODE_ENV: 'development',
  DEBUG: true
}
```

Now run it without the `.env` file to see what a mistake looks like:

```bash
node app.mjs
```

```
envshape: 1 environment variable needs fixing:

  DATABASE_URL is missing.
    Fix: Set DATABASE_URL in your environment or .env file (for example DATABASE_URL=postgres://localhost:5432/app), or give it a default in your schema.
```

The process exits with code 1 and no stack trace. In TypeScript the same code works unchanged, and every property of `env` is typed.

## API

### `parseEnv(schema, options?)`

Reads each variable in `schema`, validates and converts it, and returns a frozen object with one typed property per key. Unset and empty (or whitespace-only) variables count as missing.

| Option        | Default       | What it does                                                                 |
| ------------- | ------------- | ---------------------------------------------------------------------------- |
| `env`         | `process.env` | Object to read variables from. Useful in tests.                              |
| `exitOnError` | `false`       | Print the problems to stderr and exit with code 1 instead of throwing.       |

Without `exitOnError`, problems throw an `EnvError`. Its `issues` array has one `{ key, problem, message, fix }` entry per variable, where `problem` is `"missing"` or `"invalid"`.

### Validators

| Validator               | Result type          | Accepts                                                        |
| ----------------------- | -------------------- | -------------------------------------------------------------- |
| `str()`                 | `string`             | Any non-empty value, returned exactly as set.                  |
| `num({ min, max, integer })` | `number`        | `42`, `-1.5`, `1e3`. Rejects `12px`, `0x10`, `Infinity`.       |
| `bool()`                | `boolean`            | `true/false`, `1/0`, `yes/no`, `y/n`, `on/off`, any case.      |
| `url({ protocols })`    | `string`             | Absolute URLs. `protocols: ["https"]` restricts the scheme.    |
| `port()`                | `number`             | Whole numbers from 1 to 65535.                                 |
| `oneOf(choices)`        | union of `choices`   | Exactly one of the listed strings (case-sensitive).            |
| `list({ separator })`   | `string[]`           | `a, b, c`, split on `","` by default. Items are trimmed.       |
| `json<T>()`             | `T` (default `unknown`) | Anything `JSON.parse` accepts.                              |

Every validator also takes these options:

| Option     | What it does                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `default`  | Value used when the variable is missing. The result type stays non-optional.                       |
| `optional` | Allow the variable to be missing. Without a `default`, its type becomes `T \| undefined`.           |
| `desc`     | Describes the variable in error messages.                                                          |
| `example`  | Shown in the fix hint when the variable is missing.                                                |
| `secret`   | Hide the value in error messages. On by default for names containing `SECRET`, `TOKEN`, `PASSWORD`, `KEY`, `AUTH` and similar; `secret: false` turns it off. |

```js
import { parseEnv, str, num, list, json } from "envshape";

const env = parseEnv({
  WORKERS: num({ integer: true, min: 1, max: 64, default: 4 }),
  ALLOWED_ORIGINS: list({ default: ["http://localhost:3000"] }),
  SENTRY_DSN: str({ optional: true, desc: "Error reporting; leave unset to disable" }),
  FEATURE_FLAGS: json({ default: {} }),
});
```

## CLI

Check an environment against a JSON schema without writing any code, for example in CI or a Docker entrypoint.

Create `env.schema.json`:

```json
{
  "PORT": { "type": "port", "default": 3000 },
  "DATABASE_URL": { "type": "url", "protocols": ["postgres", "postgresql"] },
  "NODE_ENV": { "type": "oneOf", "choices": ["development", "production", "test"], "default": "development" },
  "DEBUG": "bool"
}
```

Then, next to the `.env` file from the quick start:

```bash
npx envshape check env.schema.json --env-file .env
```

```
envshape: OK, 4 variables valid.
```

Types are `str`, `num`, `int`, `bool`, `url`, `port`, `oneOf`, `list` and `json`. Options match the validator options above. Exit codes: `0` valid, `1` variables missing or invalid, `2` bad command or schema file. Run `npx envshape --help` for everything else.

## Troubleshooting

**"X is missing" but it's in my `.env` file.** Node.js doesn't read `.env` files on its own. Start your app with `node --env-file=.env app.js`, or call `process.loadEnvFile()` before `parseEnv`.

**"schema.PORT is the function port, not a validator".** Call the validator: write `PORT: port()`, not `PORT: port`.

**I set a variable to an empty string and it's reported as missing.** On purpose: `FOO=` in a `.env` file is almost always a mistake. Use `optional: true` or a `default` if empty is fine.

**`ERR_REQUIRE_ESM` when using `require("envshape")`.** envshape is an ES module. Use `import`, or upgrade to Node.js 22.12 or later, where `require()` of ES modules works.

**An error says the value is "hidden because it may be secret".** The variable's name looks like a secret (it contains `KEY`, `TOKEN`, `AUTH` and so on), so its value isn't printed. If it isn't secret, pass `secret: false` to its validator.

## License

[MIT](LICENSE)
