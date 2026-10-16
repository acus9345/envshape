import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const CLI = join(import.meta.dirname, "..", "dist", "cli.js");
const dir = mkdtempSync(join(tmpdir(), "envshape-cli-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function cli(args: string[], env: Record<string, string> = {}) {
  // Start from a minimal environment so the user's own variables don't leak in.
  const base = { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" };
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", env: { ...base, ...env } });
}

const SCHEMA = JSON.stringify({
  PORT: { type: "port", default: 3000 },
  DATABASE_URL: { type: "url", protocols: ["postgres"], desc: "Postgres connection string" },
  NODE_ENV: { type: "oneOf", choices: ["development", "production"] },
  DEBUG: "bool",
});

describe("cli", () => {
  it("--help and no arguments print usage", () => {
    for (const args of [["--help"], ["-h"], []]) {
      const r = cli(args);
      assert.equal(r.status, 0);
      assert.match(r.stdout, /Usage:\n {2}envshape check <schema.json>/);
      assert.match(r.stdout, /Examples:/);
    }
  });

  it("--version prints the package version", () => {
    const { version } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"));
    for (const flag of ["--version", "-v"]) {
      const r = cli([flag]);
      assert.equal(r.status, 0);
      assert.equal(r.stdout.trim(), version);
    }
  });

  it("check passes with a valid environment", () => {
    const schema = file("ok.json", SCHEMA);
    const r = cli(["check", schema], { DATABASE_URL: "postgres://db/app", NODE_ENV: "production", DEBUG: "true" });
    assert.equal(r.stderr, "");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "envshape: OK, 4 variables valid.\n");
  });

  it("--quiet prints nothing on success", () => {
    const schema = file("quiet.json", '{"A":"str"}');
    const r = cli(["check", schema, "-q"], { A: "x" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  it("check fails with exit code 1 and lists every problem", () => {
    const schema = file("bad-env.json", SCHEMA);
    const r = cli(["check", schema], { DATABASE_URL: "mysql://db/app", DEBUG: "maybe" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /3 environment variables need fixing/);
    assert.match(r.stderr, /DATABASE_URL must be a postgres URL/);
    assert.match(r.stderr, /NODE_ENV is missing/);
    assert.match(r.stderr, /DEBUG must be a boolean/);
    assert.doesNotMatch(r.stderr, /\n\s+at /, "no stack trace");
  });

  it("--env-file loads variables, and the real environment wins", () => {
    const schema = file("envfile.json", '{"A":"str","B":"num"}');
    const envFile = file(".env.test", "# comment\nA=from-file\nB=1\n");
    const r = cli(["check", schema, "--env-file", envFile], { B: "2" });
    assert.equal(r.status, 0, r.stderr);
    const failing = cli(["check", schema, "--env-file", envFile], { B: "two" });
    assert.equal(failing.status, 1);
    assert.match(failing.stderr, /B must be a number, but got "two"/);
  });

  const usageErrors: [string, string[], RegExp][] = [
    ["unknown command", ["lint"], /unknown command "lint"/],
    ["schema as command", ["env.json"], /Did you mean "envshape check env.json"\?/],
    ["missing schema arg", ["check"], /missing schema file/],
    ["extra argument", ["check", "a.json", "b.json"], /unexpected argument "b.json"/],
    ["unknown flag", ["check", "a.json", "--nope"], /Unknown option '--nope'/],
    ["missing schema file", ["check", "does-not-exist.json"], /can't find schema file "does-not-exist.json"/],
  ];
  for (const [name, args, pattern] of usageErrors) {
    it(`usage error: ${name}`, () => {
      const r = cli(args);
      assert.equal(r.status, 2);
      assert.match(r.stderr, pattern);
      assert.match(r.stderr, /Run "envshape --help" for usage\./);
      assert.doesNotMatch(r.stderr, /\n\s+at /, "no stack trace");
    });
  }

  const schemaErrors: [string, string, RegExp][] = [
    ["invalid JSON", "{ nope", /is not valid JSON/],
    ["array schema", "[]", /must contain a JSON object/],
    ["missing type", '{"A":{}}', /"A" needs a type/],
    ["unknown type", '{"A":"float"}', /"A" has unknown type "float"\. Types: str, num/],
    ["oneOf without choices", '{"A":"oneOf"}', /"A" is a oneOf, so it needs "choices"/],
    ["choices on non-oneOf", '{"A":{"type":"str","choices":["x"]}}', /only oneOf uses them/],
    ["unknown option", '{"A":{"type":"num","mni":1}}', /"A": unknown option "mni" in num\(\)/],
    ["prototype key as type", '{"A":"toString"}', /unknown type "toString"/],
  ];
  for (const [name, content, pattern] of schemaErrors) {
    it(`schema error: ${name}`, () => {
      const r = cli(["check", file(`schema-${name.replace(/\W+/g, "-")}.json`, content)]);
      assert.equal(r.status, 2);
      assert.match(r.stderr, pattern);
      assert.doesNotMatch(r.stderr, /\n\s+at /, "no stack trace");
    });
  }

  it("int type requires whole numbers", () => {
    const schema = file("int.json", '{"N":{"type":"int","min":0}}');
    assert.equal(cli(["check", schema], { N: "5" }).status, 0);
    assert.match(cli(["check", schema], { N: "5.5" }).stderr, /N must be an integer of at least 0/);
  });
});
