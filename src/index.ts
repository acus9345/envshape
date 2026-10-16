/**
 * envshape: validate environment variables and get a typed, frozen config object back.
 *
 * @example
 * ```ts
 * import { parseEnv, port, url, bool } from "envshape";
 *
 * const env = parseEnv({
 *   PORT: port({ default: 3000 }),
 *   DATABASE_URL: url(),
 *   DEBUG: bool({ default: false }),
 * });
 * env.PORT; // number
 * ```
 * @packageDocumentation
 */

/** Variable names mapped to raw string values, like `process.env`. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Options every validator accepts. */
export interface BaseOptions<T> {
  /** Value used when the variable is unset or empty. */
  readonly default?: T;
  /** Let the variable be unset. Its value is then `undefined` (or `default`, if given). */
  readonly optional?: boolean;
  /** What the variable is for. Shown in error messages. */
  readonly desc?: string;
  /** An example value. Shown in the fix hint when the variable is missing. */
  readonly example?: string;
  /**
   * Hide this variable's value in error messages. By default, values are hidden
   * when the name contains SECRET, TOKEN, PASSWORD, KEY or similar words; set
   * `false` to always show the value.
   */
  readonly secret?: boolean;
}

/** Options for {@link num}. */
export interface NumOptions extends BaseOptions<number> {
  /** Smallest allowed value (inclusive). */
  readonly min?: number;
  /** Largest allowed value (inclusive). */
  readonly max?: number;
  /** Only accept whole numbers. */
  readonly integer?: boolean;
}

/** Options for {@link url}. */
export interface UrlOptions extends BaseOptions<string> {
  /** Allowed protocols, e.g. `["https"]` or `["postgres", "postgresql"]`. Any protocol is allowed by default. */
  readonly protocols?: readonly string[];
}

/** Options for {@link list}. */
export interface ListOptions extends BaseOptions<string[]> {
  /** Text between items. Defaults to `","`. */
  readonly separator?: string;
}

/**
 * Checks and converts one environment variable.
 * Create validators with {@link str}, {@link num}, {@link bool}, {@link url},
 * {@link port}, {@link oneOf}, {@link list} or {@link json}.
 */
export interface Validator<T> {
  /** What the validator expects, e.g. `"a port number (1-65535)"`. Used in error messages. */
  readonly expected: string;
  /** The options this validator was created with. */
  readonly options: BaseOptions<unknown>;
  /**
   * Converts a raw, non-empty string to the typed value. Throws when the value is
   * invalid; a non-empty error message is shown to the user as the fix hint.
   */
  parse(raw: string): T;
  /** Type-level marker for the output type. Never set at runtime. */
  readonly __output?: T;
}

/** An object mapping variable names to validators. */
export type Schema = Readonly<Record<string, Validator<unknown>>>;

/** The typed result of {@link parseEnv} for schema `S`. */
export type InferEnv<S extends Schema> = {
  readonly [K in keyof S]: S[K] extends Validator<infer T> ? T : never;
};

/** Options for {@link parseEnv}. */
export interface ParseOptions {
  /** Where to read variables from. Defaults to `process.env`. */
  readonly env?: EnvSource;
  /**
   * On invalid or missing variables, print the problems to stderr and exit with
   * code 1 instead of throwing an {@link EnvError}. Handy at app startup.
   */
  readonly exitOnError?: boolean;
}

/** One problem found by {@link parseEnv}. */
export interface EnvIssue {
  /** The variable name. */
  readonly key: string;
  /** Whether the variable was missing or had an invalid value. */
  readonly problem: "missing" | "invalid";
  /** What went wrong, e.g. `PORT must be a port number (1-65535), but got "abc".` */
  readonly message: string;
  /** How to fix it. */
  readonly fix: string;
}

/** Thrown by {@link parseEnv} when variables are missing or invalid. Lists every problem at once. */
export class EnvError extends Error {
  override readonly name = "EnvError";
  /** Every problem found, in schema order. */
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[]) {
    super(formatIssues(issues));
    this.issues = issues;
  }
}

// Output type of a validator built from options O: T, or T | undefined when optional without a default.
type Output<T, O> = O extends { readonly default: unknown }
  ? T
  : O extends { readonly optional: true }
    ? T | undefined
    : T;

// Rejects option names that the validator doesn't know about, so typos fail to compile.
type NoExtra<O, Allowed> = O & { readonly [K in Exclude<keyof O, keyof Allowed>]: never };

const BASE_KEYS = ["default", "optional", "desc", "example", "secret"] as const;

/** A string. Returned exactly as set. */
export function str<const O extends BaseOptions<string> = {}>(
  options?: NoExtra<O, BaseOptions<string>>,
): Validator<Output<string, O>> {
  return make("str", "a string", options, [], (raw) => raw);
}

/** A number, e.g. `3.5` or `-2`. Use `integer`, `min` and `max` to narrow it. */
export function num<const O extends NumOptions = {}>(
  options?: NoExtra<O, NumOptions>,
): Validator<Output<number, O>> {
  const opts = checkOptions("num", options, ["min", "max", "integer"]);
  const { min, max, integer = false } = opts as NumOptions;
  for (const [name, value] of [["min", min], ["max", max]] as const) {
    if (value !== undefined && !Number.isFinite(value)) {
      throw new TypeError(`envshape: num() option "${name}" must be a finite number, but got ${describe(value)}.`);
    }
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw new TypeError(`envshape: num() option "min" (${min}) is larger than "max" (${max}). Swap them.`);
  }
  const range =
    min !== undefined && max !== undefined
      ? ` between ${min} and ${max}`
      : min !== undefined
        ? ` of at least ${min}`
        : max !== undefined
          ? ` of at most ${max}`
          : "";
  const expected = `${integer ? "an integer" : "a number"}${range}`;
  return make("num", expected, opts, ["min", "max", "integer"], (raw) => {
    const text = raw.trim();
    if (!NUMBER_RE.test(text)) throw new Error("");
    const n = Number(text);
    if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) throw new Error("");
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) throw new Error("");
    return n;
  });
}

/** A boolean. Accepts true/false, 1/0, yes/no, on/off (any case). */
export function bool<const O extends BaseOptions<boolean> = {}>(
  options?: NoExtra<O, BaseOptions<boolean>>,
): Validator<Output<boolean, O>> {
  return make("bool", "a boolean (true/false, 1/0, yes/no, on/off)", options, [], (raw) => {
    const text = raw.trim().toLowerCase();
    if (TRUE_WORDS.has(text)) return true;
    if (FALSE_WORDS.has(text)) return false;
    throw new Error("");
  });
}

/** An absolute URL, returned as a string. Use `protocols` to restrict the scheme. */
export function url<const O extends UrlOptions = {}>(
  options?: NoExtra<O, UrlOptions>,
): Validator<Output<string, O>> {
  const opts = checkOptions("url", options, ["protocols"]);
  const raw = (opts as UrlOptions).protocols;
  if (raw !== undefined && (!Array.isArray(raw) || raw.length === 0 || !raw.every((p) => typeof p === "string" && p))) {
    throw new TypeError('envshape: url() option "protocols" must be a non-empty list of strings, e.g. ["https"].');
  }
  const protocols = raw?.map((p) => p.toLowerCase().replace(/:$/, ""));
  const expected = protocols ? `a ${protocols.join(" or ")} URL` : "a valid URL (e.g. https://example.com)";
  return make("url", expected, opts, ["protocols"], (value) => {
    const text = value.trim();
    if (!URL.canParse(text)) throw new Error("");
    const scheme = new URL(text).protocol.slice(0, -1);
    if (protocols && !protocols.includes(scheme)) {
      throw new Error(`Use a URL starting with ${protocols.map((p) => `${p}://`).join(" or ")}.`);
    }
    return text;
  });
}

/** A TCP/UDP port number from 1 to 65535. */
export function port<const O extends BaseOptions<number> = {}>(
  options?: NoExtra<O, BaseOptions<number>>,
): Validator<Output<number, O>> {
  return make("port", "a port number (1-65535)", options, [], (raw) => {
    const text = raw.trim();
    if (!/^\d+$/.test(text)) throw new Error("");
    const n = Number(text);
    if (n < 1 || n > 65535) throw new Error("");
    return n;
  });
}

/** One of a fixed set of strings. The result is typed as the union of `choices`. */
export function oneOf<const C extends readonly [string, ...string[]], const O extends BaseOptions<C[number]> = {}>(
  choices: C,
  options?: NoExtra<O, BaseOptions<C[number]>>,
): Validator<Output<C[number], O>> {
  if (!Array.isArray(choices) || choices.length === 0 || !choices.every((c) => typeof c === "string")) {
    throw new TypeError(
      `envshape: oneOf() needs a non-empty list of strings, e.g. oneOf(["development", "production"]), but got ${describe(choices)}.`,
    );
  }
  const list = [...choices];
  return make("oneOf", `one of: ${list.join(", ")}`, options, [], (raw) => {
    const text = raw.trim();
    if (list.includes(text)) return text as C[number];
    const close = list.find((c) => c.toLowerCase() === text.toLowerCase());
    throw new Error(close ? `Did you mean "${close}"? Values are case-sensitive.` : "");
  });
}

/** A list of strings split on `separator` (default `","`). Items are trimmed and empty items dropped. */
export function list<const O extends ListOptions = {}>(
  options?: NoExtra<O, ListOptions>,
): Validator<Output<string[], O>> {
  const opts = checkOptions("list", options, ["separator"]);
  const separator = (opts as ListOptions).separator ?? ",";
  if (typeof separator !== "string" || separator === "") {
    throw new TypeError('envshape: list() option "separator" must be a non-empty string, e.g. "," or ";".');
  }
  return make("list", `a list separated by "${separator}"`, opts, ["separator"], (raw) => {
    const items = raw
      .split(separator)
      .map((item) => item.trim())
      .filter((item) => item !== "");
    if (items.length === 0) throw new Error("");
    return items;
  });
}

/** JSON, parsed with `JSON.parse`. Pass a type argument to type the result: `json<{ a: number }>()`. */
export function json<T = unknown>(
  options: BaseOptions<T> & { readonly optional: true; readonly default?: undefined },
): Validator<T | undefined>;
export function json<T = unknown>(options?: BaseOptions<T>): Validator<T>;
export function json<T = unknown>(options?: BaseOptions<T>): Validator<T> {
  return make("json", "valid JSON", options, [], (raw) => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      // The parser's message can quote the value, which might be secret.
      throw new Error("");
    }
  });
}

/**
 * Reads, validates and converts environment variables.
 *
 * Every variable is checked before anything is reported, so one run shows every
 * problem. Unset and empty variables count as missing.
 *
 * @param schema Variable names mapped to validators, e.g. `{ PORT: port() }`.
 * @param options Where to read from, and whether to exit instead of throwing.
 * @returns A frozen object with one typed property per schema key.
 * @throws {EnvError} When variables are missing or invalid (unless `exitOnError` is set).
 * @throws {TypeError} When the schema itself is malformed.
 */
export function parseEnv<const S extends Schema>(schema: S, options: ParseOptions = {}): InferEnv<S> {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError(`envshape: parseEnv() expects a schema object like { PORT: port() }, but got ${describe(schema)}.`);
  }
  for (const [key, validator] of Object.entries(schema as Record<string, unknown>)) {
    if (!isValidator(validator)) {
      throw new TypeError(
        typeof validator === "function" && validator.name
          ? `envshape: schema.${key} is the function ${validator.name}, not a validator. Call it: ${key}: ${validator.name}()`
          : `envshape: schema.${key} must be a validator such as str(), num() or bool(), but got ${describe(validator)}.`,
      );
    }
  }
  const source = options.env ?? (globalThis as { process?: { env?: EnvSource } }).process?.env;
  if (source === null || typeof source !== "object") {
    throw new TypeError("envshape: no environment to read. Pass one with parseEnv(schema, { env: { ... } }).");
  }

  const result: Record<string, unknown> = {};
  const issues: EnvIssue[] = [];
  for (const [key, validator] of Object.entries(schema)) {
    const opts = validator.options ?? {};
    const raw = source[key];
    if (raw === undefined || raw.trim() === "") {
      if (opts.default !== undefined) result[key] = opts.default;
      else if (opts.optional) result[key] = undefined;
      else issues.push(missingIssue(key, opts));
      continue;
    }
    try {
      result[key] = validator.parse(raw);
    } catch (error) {
      issues.push(invalidIssue(key, raw, validator, error));
    }
  }

  if (issues.length > 0) {
    const error = new EnvError(issues);
    if (options.exitOnError) {
      const proc = (globalThis as { process?: { stderr?: { write(s: string): void }; exit?(code: number): never } }).process;
      if (proc?.exit) {
        proc.stderr?.write(`${error.message}\n`);
        proc.exit(1);
      }
    }
    throw error;
  }
  return Object.freeze(result) as InferEnv<S>;
}

// ---------------------------------------------------------------------------
// Internals

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
const TRUE_WORDS = new Set(["true", "1", "yes", "y", "on"]);
const FALSE_WORDS = new Set(["false", "0", "no", "n", "off"]);
const SECRET_RE = /secret|token|passw|pwd|private|credential|api_?key|(^|_)key($|_)|auth|session|cookie|salt/i;
const MAX_SHOWN = 60;

function make<T>(
  fn: string,
  expected: string,
  options: object | undefined,
  extraKeys: readonly string[],
  parse: (raw: string) => T,
): Validator<never> {
  const opts = checkOptions(fn, options, extraKeys);
  // `never` lets each factory declare its own output type (e.g. `T | undefined` when optional).
  return Object.freeze({ expected, options: Object.freeze({ ...opts }), parse }) as Validator<never>;
}

function checkOptions(fn: string, options: object | undefined, extraKeys: readonly string[]): BaseOptions<unknown> {
  if (options === undefined) return {};
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(`envshape: ${fn}() options must be an object like { default: ... }, but got ${describe(options)}.`);
  }
  const allowed = [...BASE_KEYS, ...extraKeys];
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`envshape: unknown option "${key}" in ${fn}(). Valid options: ${allowed.join(", ")}.`);
    }
  }
  const opts = options as BaseOptions<unknown>;
  for (const key of ["desc", "example"] as const) {
    if (opts[key] !== undefined && typeof opts[key] !== "string") {
      throw new TypeError(`envshape: ${fn}() option "${key}" must be a string, but got ${describe(opts[key])}.`);
    }
  }
  return opts;
}

function isValidator(value: unknown): value is Validator<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Validator<unknown>).parse === "function" &&
    typeof (value as Validator<unknown>).expected === "string"
  );
}

function missingIssue(key: string, opts: BaseOptions<unknown>): EnvIssue {
  const example = opts.example === undefined ? "" : ` (for example ${key}=${opts.example})`;
  return {
    key,
    problem: "missing",
    message: `${key} is missing.${opts.desc ? ` ${key}: ${opts.desc}` : ""}`,
    fix: `Set ${key} in your environment or .env file${example}, or give it a default in your schema.`,
  };
}

function invalidIssue(key: string, raw: string, validator: Validator<unknown>, error: unknown): EnvIssue {
  const hidden = validator.options?.secret ?? SECRET_RE.test(key);
  const got = hidden ? "a value that is hidden because it may be secret" : JSON.stringify(shorten(maskCredentials(raw)));
  const hint = error instanceof Error && error.message ? `${error.message} ` : "";
  return {
    key,
    problem: "invalid",
    message: `${key} must be ${validator.expected}, but got ${got}.${validator.options?.desc ? ` ${key}: ${validator.options.desc}` : ""}`,
    fix: `${hint}Change ${key} in your environment or .env file.`,
  };
}

function formatIssues(issues: readonly EnvIssue[]): string {
  const count = issues.length === 1 ? "1 environment variable needs" : `${issues.length} environment variables need`;
  const body = issues.map((issue) => `  ${issue.message}\n    Fix: ${issue.fix}`).join("\n\n");
  return `envshape: ${count} fixing:\n\n${body}`;
}

function maskCredentials(value: string): string {
  return value.replace(/(\/\/)[^/@\s]+@/g, "$1***@");
}

function shorten(value: string): string {
  return value.length > MAX_SHOWN ? `${value.slice(0, MAX_SHOWN - 3)}...` : value;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return JSON.stringify(shorten(value));
  if (typeof value === "function") return "a function";
  if (typeof value === "object") return "an object";
  return String(value);
}
