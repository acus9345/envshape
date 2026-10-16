import { bool, json, list, num, oneOf, port, str, url, type Schema, type Validator } from "./index.js";

/** A problem in a JSON schema file, described in terms of the file. */
export class SchemaFileError extends Error {
  override readonly name = "SchemaFileError";
}

type Factory = (options: Record<string, unknown>) => Validator<unknown>;

// Options from a JSON file are untyped; the validators check them at runtime.
const loose = (fn: unknown) => fn as (options?: object) => Validator<unknown>;

const TYPES: Readonly<Record<string, Factory>> = {
  str: loose(str),
  string: loose(str),
  num: loose(num),
  number: loose(num),
  int: (o) => loose(num)({ ...o, integer: true }),
  integer: (o) => loose(num)({ ...o, integer: true }),
  bool: loose(bool),
  boolean: loose(bool),
  url: loose(url),
  port: loose(port),
  list: loose(list),
  json: loose(json),
};

const TYPE_NAMES = "str, num, int, bool, url, port, oneOf, list, json";

/**
 * Builds a schema from parsed JSON such as
 * `{ "PORT": { "type": "port", "default": 3000 }, "DEBUG": "bool" }`.
 */
export function schemaFromJson(data: unknown, file: string): Schema {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new SchemaFileError(
      `${file} must contain a JSON object mapping variable names to types, e.g. { "PORT": "port" }.`,
    );
  }
  const schema: Record<string, Validator<unknown>> = {};
  for (const [key, entry] of Object.entries(data)) {
    const spec: unknown = typeof entry === "string" ? { type: entry } : entry;
    if (spec === null || typeof spec !== "object" || Array.isArray(spec) || typeof (spec as { type?: unknown }).type !== "string") {
      throw new SchemaFileError(
        `${file}: "${key}" needs a type, e.g. "${key}": "str" or "${key}": { "type": "str" }. Types: ${TYPE_NAMES}.`,
      );
    }
    const { type, choices, ...options } = spec as { type: string; choices?: unknown } & Record<string, unknown>;
    try {
      if (type === "oneOf" || type === "enum") {
        if (!Array.isArray(choices) || choices.length === 0 || !choices.every((c) => typeof c === "string")) {
          throw new SchemaFileError(
            `${file}: "${key}" is a oneOf, so it needs "choices": a list of strings, e.g. "choices": ["dev", "prod"].`,
          );
        }
        schema[key] = (oneOf as (c: readonly string[], o: object) => Validator<unknown>)(choices, options);
        continue;
      }
      const factory = Object.hasOwn(TYPES, type) ? TYPES[type] : undefined;
      if (!factory) {
        throw new SchemaFileError(`${file}: "${key}" has unknown type "${type}". Types: ${TYPE_NAMES}.`);
      }
      if (choices !== undefined) {
        throw new SchemaFileError(`${file}: "${key}" has "choices", but only oneOf uses them. Did you mean "type": "oneOf"?`);
      }
      schema[key] = factory(options);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new SchemaFileError(`${file}: "${key}": ${error.message.replace(/^envshape: /, "")}`);
      }
      throw error;
    }
  }
  return schema;
}
