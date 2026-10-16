#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs, parseEnv as parseDotenv } from "node:util";
import { EnvError, parseEnv } from "./index.js";
import { SchemaFileError, schemaFromJson } from "./schema-file.js";

const HELP = `envshape - check environment variables against a schema

Usage:
  envshape check <schema.json> [--env-file <path>] [--quiet]

Commands:
  check <schema.json>   Validate the current environment against a JSON schema.
                        Exits 0 if valid, 1 if variables are missing or invalid,
                        2 if the command or schema file is wrong.

Options:
  --env-file <path>     Also read variables from a .env file.
                        Variables already in the environment take priority.
  -q, --quiet           Print nothing when everything is valid.
  -h, --help            Show this help.
  -v, --version         Show the version number.

Schema file example (env.schema.json):
  {
    "PORT": { "type": "port", "default": 3000 },
    "DATABASE_URL": { "type": "url", "desc": "Postgres connection string" },
    "NODE_ENV": { "type": "oneOf", "choices": ["development", "production", "test"] },
    "DEBUG": "bool"
  }
  Types: str, num, int, bool, url, port, oneOf, list, json
  Options: default, optional, desc, example, secret, min, max, protocols, separator

Examples:
  envshape check env.schema.json
  envshape check env.schema.json --env-file .env
`;

class UsageError extends Error {}

function readText(path: string, what: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new UsageError(`can't find ${what} "${path}" (looked for ${resolve(path)}).`);
    if (code === "EISDIR") throw new UsageError(`${what} "${path}" is a folder, not a file.`);
    throw new UsageError(`can't read ${what} "${path}": ${(error as Error).message}`);
  }
}

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return pkg.version;
}

function run(argv: readonly string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        "env-file": { type: "string" },
        quiet: { type: "boolean", short: "q" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;

  if (values.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return 0;
  }

  const [command, file, ...extra] = positionals;
  if (command !== "check") {
    const hint = command?.endsWith(".json") ? ` Did you mean "envshape check ${command}"?` : "";
    throw new UsageError(`unknown command "${command}".${hint}`);
  }
  if (file === undefined) throw new UsageError("missing schema file. Usage: envshape check <schema.json>");
  if (extra.length > 0) throw new UsageError(`unexpected argument "${extra[0]}". Usage: envshape check <schema.json>`);

  let data: unknown;
  try {
    data = JSON.parse(readText(file, "schema file"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new UsageError(`${file} is not valid JSON: ${error.message}`);
    throw error;
  }
  const schema = schemaFromJson(data, file);

  let env: Record<string, string | undefined> = process.env;
  const envFile = values["env-file"];
  if (envFile !== undefined) {
    env = { ...(parseDotenv(readText(envFile, "env file")) as Record<string, string>), ...process.env };
  }

  parseEnv(schema, { env });
  if (!values.quiet) {
    const count = Object.keys(schema).length;
    process.stdout.write(`envshape: OK, ${count} ${count === 1 ? "variable" : "variables"} valid.\n`);
  }
  return 0;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  if (error instanceof EnvError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else if (error instanceof UsageError || error instanceof SchemaFileError) {
    process.stderr.write(`envshape: ${error.message}\nRun "envshape --help" for usage.\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
