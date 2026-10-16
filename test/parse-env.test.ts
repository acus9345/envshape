import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { bool, EnvError, json, list, num, oneOf, parseEnv, port, str, url, type Validator } from "../dist/index.js";

function errorOf(fn: () => unknown): EnvError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof EnvError, `expected EnvError, got ${String(error)}`);
    return error;
  }
  assert.fail("expected parseEnv to throw");
}

describe("parseEnv basics", () => {
  it("parses every validator type", () => {
    const env = parseEnv(
      {
        NAME: str(),
        RATIO: num(),
        DEBUG: bool(),
        API: url(),
        PORT: port(),
        MODE: oneOf(["dev", "prod"]),
        HOSTS: list(),
        FLAGS: json<{ a: number }>(),
      },
      {
        env: {
          NAME: " Ada ",
          RATIO: "0.75",
          DEBUG: "yes",
          API: "https://api.example.com/v1",
          PORT: "8080",
          MODE: "prod",
          HOSTS: "a.com, b.com,,c.com ",
          FLAGS: '{"a":1}',
        },
      },
    );
    assert.deepEqual(env, {
      NAME: " Ada ",
      RATIO: 0.75,
      DEBUG: true,
      API: "https://api.example.com/v1",
      PORT: 8080,
      MODE: "prod",
      HOSTS: ["a.com", "b.com", "c.com"],
      FLAGS: { a: 1 },
    });
  });

  it("returns a frozen object", () => {
    const env = parseEnv({ A: str() }, { env: { A: "x" } });
    assert.ok(Object.isFrozen(env));
  });

  it("reads process.env by default", () => {
    process.env.ENVSHAPE_TEST_VAR = "42";
    try {
      assert.equal(parseEnv({ ENVSHAPE_TEST_VAR: num() }).ENVSHAPE_TEST_VAR, 42);
    } finally {
      delete process.env.ENVSHAPE_TEST_VAR;
    }
  });

  it("only returns keys from the schema", () => {
    const env = parseEnv({ A: str() }, { env: { A: "1", B: "2" } });
    assert.deepEqual(Object.keys(env), ["A"]);
  });

  it("accepts an empty schema", () => {
    assert.deepEqual(parseEnv({}, { env: {} }), {});
  });
});

describe("defaults and optional", () => {
  it("uses the default when unset", () => {
    assert.equal(parseEnv({ PORT: port({ default: 3000 }) }, { env: {} }).PORT, 3000);
  });

  it("treats empty and whitespace-only values as unset", () => {
    const env = parseEnv({ A: str({ default: "d" }), B: num({ default: 1 }) }, { env: { A: "", B: "   " } });
    assert.deepEqual(env, { A: "d", B: 1 });
  });

  it("does not use the default when a value is set", () => {
    assert.equal(parseEnv({ DEBUG: bool({ default: true }) }, { env: { DEBUG: "false" } }).DEBUG, false);
  });

  it("returns undefined for optional variables", () => {
    const env = parseEnv({ A: str({ optional: true }) }, { env: {} });
    assert.ok("A" in env);
    assert.equal(env.A, undefined);
  });

  it("prefers the default over undefined for optional variables", () => {
    assert.equal(parseEnv({ A: str({ optional: true, default: "x" }) }, { env: {} }).A, "x");
  });
});

describe("validators", () => {
  const ok = <T>(v: Validator<T>, raw: string): T => parseEnv({ X: v }, { env: { X: raw } }).X;
  const bad = (v: Validator<unknown>, raw: string) => errorOf(() => parseEnv({ X: v }, { env: { X: raw } }));

  it("num accepts decimals, signs and exponents", () => {
    assert.equal(ok(num(), "-2.5"), -2.5);
    assert.equal(ok(num(), "+3"), 3);
    assert.equal(ok(num(), "1e3"), 1000);
    assert.equal(ok(num(), ".5"), 0.5);
    assert.equal(ok(num(), " 7 "), 7);
  });

  it("num rejects non-numbers", () => {
    for (const raw of ["abc", "12px", "0x10", "Infinity", "NaN", "1,000", "1e999"]) {
      assert.match(bad(num(), raw).message, /X must be a number/, raw);
    }
  });

  it("num enforces integer, min and max", () => {
    assert.match(bad(num({ integer: true }), "1.5").message, /must be an integer/);
    assert.match(bad(num({ min: 1, max: 10 }), "11").message, /between 1 and 10/);
    assert.match(bad(num({ min: 5 }), "4").message, /at least 5/);
    assert.match(bad(num({ max: 5 }), "6").message, /at most 5/);
    assert.equal(ok(num({ min: 1, max: 10 }), "10"), 10);
  });

  it("bool accepts common spellings in any case", () => {
    for (const raw of ["true", "TRUE", "1", "yes", "Y", "on"]) assert.equal(ok(bool(), raw), true, raw);
    for (const raw of ["false", "False", "0", "no", "N", "off"]) assert.equal(ok(bool(), raw), false, raw);
    assert.match(bad(bool(), "maybe").message, /must be a boolean/);
  });

  it("url validates and restricts protocols", () => {
    assert.equal(ok(url(), " http://localhost:3000 "), "http://localhost:3000");
    assert.match(bad(url(), "not a url").message, /must be a valid URL/);
    const pg = url({ protocols: ["postgres", "postgresql:"] });
    assert.equal(ok(pg, "postgresql://localhost/app"), "postgresql://localhost/app");
    const error = bad(pg, "mysql://localhost/app");
    assert.match(error.message, /must be a postgres or postgresql URL/);
    assert.match(error.issues[0]!.fix, /postgres:\/\/ or postgresql:\/\//);
  });

  it("port accepts 1-65535 only", () => {
    assert.equal(ok(port(), "1"), 1);
    assert.equal(ok(port(), "65535"), 65535);
    for (const raw of ["0", "65536", "-1", "80.5", "http"]) {
      assert.match(bad(port(), raw).message, /must be a port number \(1-65535\)/, raw);
    }
  });

  it("oneOf matches exactly and suggests case fixes", () => {
    assert.equal(ok(oneOf(["dev", "prod"]), " dev "), "dev");
    const error = bad(oneOf(["development", "production"]), "Production");
    assert.match(error.message, /must be one of: development, production/);
    assert.match(error.issues[0]!.fix, /Did you mean "production"\?/);
  });

  it("list supports custom separators and rejects empty lists", () => {
    assert.deepEqual(ok(list({ separator: ";" }), "a; b;c"), ["a", "b", "c"]);
    assert.match(bad(list(), ", ,").message, /must be a list/);
  });

  it("json rejects invalid JSON", () => {
    assert.deepEqual(ok(json(), "[1,2]"), [1, 2]);
    assert.match(bad(json(), "{nope}").message, /must be valid JSON/);
  });

  it("str returns the value untouched", () => {
    assert.equal(ok(str(), "  spaced  "), "  spaced  ");
  });

  it("supports hand-written validators", () => {
    const even: Validator<number> = {
      expected: "an even number",
      options: {},
      parse(raw) {
        const n = Number(raw);
        if (n % 2 !== 0) throw new Error("Try 2, 4 or 6.");
        return n;
      },
    };
    assert.equal(ok(even, "4"), 4);
    assert.match(bad(even, "3").issues[0]!.fix, /Try 2, 4 or 6\./);
  });
});

describe("error messages", () => {
  it("reports every problem at once, in schema order", () => {
    const error = errorOf(() =>
      parseEnv(
        {
          DATABASE_URL: url({ desc: "Postgres connection string", example: "postgres://localhost/app" }),
          PORT: port(),
          MODE: oneOf(["a", "b"]),
          OK: str(),
        },
        { env: { PORT: "abc", MODE: "c", OK: "fine" } },
      ),
    );
    assert.equal(error.name, "EnvError");
    assert.deepEqual(
      error.issues.map((i) => [i.key, i.problem]),
      [
        ["DATABASE_URL", "missing"],
        ["PORT", "invalid"],
        ["MODE", "invalid"],
      ],
    );
    assert.match(error.message, /^envshape: 3 environment variables need fixing:/);
    assert.match(error.message, /DATABASE_URL is missing\. DATABASE_URL: Postgres connection string/);
    assert.match(error.message, /for example DATABASE_URL=postgres:\/\/localhost\/app/);
    assert.match(error.message, /PORT must be a port number \(1-65535\), but got "abc"\./);
    assert.match(error.message, /Fix: /);
  });

  it("uses singular wording for one problem", () => {
    assert.match(errorOf(() => parseEnv({ A: str() }, { env: {} })).message, /1 environment variable needs fixing/);
  });

  it("hides values of secret-looking variables", () => {
    for (const key of ["API_KEY", "GITHUB_TOKEN", "DB_PASSWORD", "CLIENT_SECRET", "KEY"]) {
      const error = errorOf(() => parseEnv({ [key]: num() }, { env: { [key]: "hunter2-super-private" } }));
      assert.doesNotMatch(error.message, /hunter2/, key);
      assert.match(error.message, /hidden because it may be secret/, key);
    }
  });

  it("hides values when secret: true", () => {
    const error = errorOf(() => parseEnv({ PLAIN: num({ secret: true }) }, { env: { PLAIN: "visible?" } }));
    assert.doesNotMatch(error.message, /visible\?/);
  });

  it("shows values when secret: false, even for secret-looking names", () => {
    const error = errorOf(() => parseEnv({ AUTH_MODE: num({ secret: false }) }, { env: { AUTH_MODE: "qwerty" } }));
    assert.match(error.message, /but got "qwerty"/);
  });

  it("masks credentials inside URLs", () => {
    const error = errorOf(() => parseEnv({ DATABASE_URL: port() }, { env: { DATABASE_URL: "postgres://user:pw123@db/app" } }));
    assert.doesNotMatch(error.message, /pw123/);
    assert.match(error.message, /postgres:\/\/\*\*\*@db\/app/);
  });

  it("truncates very long values", () => {
    const error = errorOf(() => parseEnv({ N: num() }, { env: { N: "x".repeat(100_000) } }));
    assert.ok(error.message.length < 500, `message is ${error.message.length} chars`);
    assert.match(error.message, /x{10,}\.\.\."/);
  });

  it("escapes newlines in shown values", () => {
    const error = errorOf(() => parseEnv({ N: num() }, { env: { N: "1\n2" } }));
    assert.match(error.message, /"1\\n2"/);
  });
});

describe("schema mistakes", () => {
  it("explains an uncalled validator", () => {
    assert.throws(
      () => parseEnv({ PORT: port } as never, { env: {} }),
      { name: "TypeError", message: /schema\.PORT is the function port, not a validator\. Call it: PORT: port\(\)/ },
    );
  });

  it("rejects non-validator values", () => {
    assert.throws(() => parseEnv({ A: 3 } as never, { env: {} }), {
      name: "TypeError",
      message: /schema\.A must be a validator such as str\(\)/,
    });
  });

  it("rejects a non-object schema", () => {
    assert.throws(() => parseEnv(null as never), { name: "TypeError", message: /expects a schema object/ });
    assert.throws(() => parseEnv([] as never), { name: "TypeError", message: /but got an array/ });
  });

  it("rejects unknown and malformed options", () => {
    assert.throws(() => num({ mni: 1 } as never), { message: /unknown option "mni" in num\(\)\. Valid options: .*min/ });
    assert.throws(() => num({ min: 5, max: 1 }), { message: /"min" \(5\) is larger than "max" \(1\)/ });
    assert.throws(() => num({ min: Number.NaN }), { message: /"min" must be a finite number/ });
    assert.throws(() => str("x" as never), { message: /options must be an object/ });
    assert.throws(() => str({ desc: 5 } as never), { message: /"desc" must be a string/ });
    assert.throws(() => oneOf([] as never), { message: /oneOf\(\) needs a non-empty list of strings/ });
    assert.throws(() => url({ protocols: [] }), { message: /"protocols" must be a non-empty list/ });
    assert.throws(() => list({ separator: "" }), { message: /"separator" must be a non-empty string/ });
  });
});

describe("large input", () => {
  it("handles thousands of variables", () => {
    const schema: Record<string, Validator<number>> = {};
    const env: Record<string, string> = {};
    for (let i = 0; i < 5000; i++) {
      schema[`VAR_${i}`] = num();
      env[`VAR_${i}`] = String(i);
    }
    const result = parseEnv(schema, { env });
    assert.equal(result.VAR_4999, 4999);
  });

  it("handles long lists and large JSON", () => {
    const items = Array.from({ length: 10_000 }, (_, i) => `item${i}`);
    assert.equal(parseEnv({ L: list() }, { env: { L: items.join(",") } }).L.length, 10_000);
    const big = JSON.stringify({ items });
    assert.deepEqual(parseEnv({ J: json<{ items: string[] }>() }, { env: { J: big } }).J.items.length, 10_000);
  });
});

describe("exitOnError", () => {
  it("prints the problems and exits with code 1", () => {
    const script = `
      import { parseEnv, port } from "./dist/index.js";
      parseEnv({ PORT: port() }, { env: { PORT: "nope" }, exitOnError: true });
      console.log("not reached");
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /PORT must be a port number/);
    assert.doesNotMatch(result.stderr, /at parseEnv|node:internal/);
  });
});
