// Compile-time checks: `npm run lint` fails if any of these types are wrong.
import assert from "node:assert/strict";
import { it } from "node:test";
import { bool, json, list, num, oneOf, parseEnv, port, str, url } from "../dist/index.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expectType = <T extends true>(_value?: T) => {};

it("infers precise types", () => {
  const env = parseEnv(
    {
      NAME: str(),
      MAYBE: str({ optional: true }),
      WITH_DEFAULT: str({ optional: true, default: "x" }),
      COUNT: num({ default: 1 }),
      DEBUG: bool(),
      API: url(),
      PORT: port(),
      MODE: oneOf(["dev", "prod"]),
      MODE_DEFAULT: oneOf(["a", "b"], { default: "a" }),
      HOSTS: list(),
      CONFIG: json<{ a: number }>(),
      OPT_CONFIG: json<{ a: number }>({ optional: true }),
    },
    {
      env: {
        NAME: "n",
        DEBUG: "1",
        API: "https://x.dev",
        PORT: "1",
        MODE: "dev",
        HOSTS: "a",
        CONFIG: '{"a":1}',
      },
    },
  );

  expectType<Equal<typeof env.NAME, string>>(true);
  expectType<Equal<typeof env.MAYBE, string | undefined>>(true);
  expectType<Equal<typeof env.WITH_DEFAULT, string>>(true);
  expectType<Equal<typeof env.COUNT, number>>(true);
  expectType<Equal<typeof env.DEBUG, boolean>>(true);
  expectType<Equal<typeof env.API, string>>(true);
  expectType<Equal<typeof env.PORT, number>>(true);
  expectType<Equal<typeof env.MODE, "dev" | "prod">>(true);
  expectType<Equal<typeof env.MODE_DEFAULT, "a" | "b">>(true);
  expectType<Equal<typeof env.HOSTS, string[]>>(true);
  expectType<Equal<typeof env.CONFIG, { a: number }>>(true);
  expectType<Equal<typeof env.OPT_CONFIG, { a: number } | undefined>>(true);

  // Type errors only; never called, because some of these also throw at runtime.
  const _compileOnly = () => {
    // @ts-expect-error: result is readonly
    env.NAME = "changed";
    // @ts-expect-error: unknown key
    void env.NOPE;
    // @ts-expect-error: misspelled option
    num({ mni: 1 });
    // @ts-expect-error: default must match the type
    port({ default: "3000" });
    // @ts-expect-error: default must be one of the choices
    oneOf(["a", "b"], { default: "c" });
  };
  void _compileOnly;

  assert.ok(true);
});
