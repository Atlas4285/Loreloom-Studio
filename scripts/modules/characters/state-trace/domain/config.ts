import { message } from "../../../../../shared/i18n/message.ts";
import { StateError } from "./errors.ts";
export type FieldType = "number" | "progress" | "text" | "toggle" | "tag";
export type Value = string | number | boolean;
export type Values = Record<string, Value>;
export interface Field {
  name: string;
  label: string;
  description: string;
  type: FieldType;
  defaultValue: Value;
  min?: number;
  max?: number;
  maxLength?: number;
  options?: string[];
}
export interface Config {
  enabled: boolean;
  fields: Field[];
  prompt?: string;
  toolDescription?: string;
}
export const FIELD_TYPES: Array<{
  value: FieldType;
  label: import("../../../../../shared/i18n/message.ts").Message;
}> = [
  {
    value: "number",
    label: message("loreloom.stateTrace.types.number", "Number"),
  },
  {
    value: "progress",
    label: message("loreloom.stateTrace.types.progress", "Progress bar"),
  },
  { value: "text", label: message("loreloom.stateTrace.types.text", "Text") },
  {
    value: "toggle",
    label: message("loreloom.stateTrace.types.toggle", "Toggle"),
  },
  { value: "tag", label: message("loreloom.stateTrace.types.tag", "Tag") },
];
export function accepts(field: Field, value: unknown): value is Value {
  switch (field.type) {
    case "number":
    case "progress":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (field.min === undefined || value >= field.min) &&
        (field.max === undefined || value <= field.max)
      );
    case "text":
      return (
        typeof value === "string" &&
        (field.maxLength === undefined || value.length <= field.maxLength)
      );
    case "toggle":
      return typeof value === "boolean";
    case "tag":
      return typeof value === "string" && !!field.options?.includes(value);
  }
}
export function validateConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new StateError(
      message(
        "loreloom.stateTrace.errors.invalidConfig",
        "Invalid configuration.",
      ),
    );
  const config = value as Config;
  if (
    typeof config.enabled !== "boolean" ||
    !Array.isArray(config.fields) ||
    config.fields.length > 256
  )
    throw new StateError(
      message(
        "loreloom.stateTrace.errors.invalidConfig",
        "Invalid configuration.",
      ),
    );
  if (config.prompt !== undefined && typeof config.prompt !== "string")
    throw new StateError(
      message(
        "loreloom.stateTrace.errors.invalidPrompt",
        "Invalid prompt format.",
      ),
    );
  if (
    config.toolDescription !== undefined &&
    typeof config.toolDescription !== "string"
  )
    throw new StateError(
      message(
        "loreloom.stateTrace.errors.invalidToolDescription",
        "Invalid tool description format.",
      ),
    );
  const names = new Set<string>();
  for (const field of config.fields) {
    if (
      !field ||
      typeof field !== "object" ||
      typeof field.name !== "string" ||
      !field.name.trim() ||
      field.name.length > 64 ||
      /[\u0000-\u001f\u007f]/.test(field.name) ||
      names.has(field.name)
    )
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.invalidNames",
          "Field names must be unique, nonempty and at most 64 characters.",
        ),
      );
    if (
      typeof field.label !== "string" ||
      typeof field.description !== "string" ||
      !FIELD_TYPES.some((item) => item.value === field.type)
    )
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.invalidField",
          "Invalid definition for field {name}.",
        ),
        { name: field.name },
      );
    for (const key of ["min", "max", "maxLength"] as const) {
      if (
        field[key] !== undefined &&
        (typeof field[key] !== "number" || !Number.isFinite(field[key]))
      )
        throw new StateError(
          message(
            "loreloom.stateTrace.errors.invalidBounds",
            "Invalid numeric constraints for field {name}.",
          ),
          { name: field.name },
        );
    }
    if (
      field.min !== undefined &&
      field.max !== undefined &&
      field.min >= field.max
    )
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.invalidRange",
          "The maximum must exceed the minimum for field {name}.",
        ),
        { name: field.name },
      );
    if (
      field.type === "progress" &&
      (field.min === undefined || field.max === undefined)
    )
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.progressBounds",
          "Progress field {name} requires a minimum and maximum.",
        ),
        { name: field.name },
      );
    if (
      field.maxLength !== undefined &&
      (!Number.isSafeInteger(field.maxLength) || field.maxLength < 1)
    )
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.invalidLength",
          "The maximum length for field {name} must be a positive integer.",
        ),
        { name: field.name },
      );
    if (
      field.type === "tag" &&
      (!Array.isArray(field.options) ||
        !field.options.length ||
        field.options.some(
          (option) => typeof option !== "string" || !option.trim(),
        ) ||
        new Set(field.options).size !== field.options.length)
    )
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.invalidOptions",
          "Tag field {name} requires unique, nonempty options.",
        ),
        { name: field.name },
      );
    if (!accepts(field, field.defaultValue))
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.invalidDefault",
          "The default value for field {name} violates its constraints.",
        ),
        { name: field.name },
      );
    names.add(field.name);
  }
  return structuredClone(config);
}
export function reconcile(config: Config, values: unknown): Values {
  const previous =
    values && typeof values === "object"
      ? (values as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    config.fields.map((field) => [
      field.name,
      accepts(field, previous[field.name])
        ? previous[field.name]
        : field.defaultValue,
    ]),
  ) as Values;
}
export function applyUpdates(
  config: Config,
  values: Values,
  updates: unknown,
): Values {
  if (!updates || typeof updates !== "object" || Array.isArray(updates))
    throw new StateError(
      message(
        "loreloom.stateTrace.errors.invalidUpdates",
        "Updates must be an object of field names and values.",
      ),
    );
  const result = reconcile(config, values);
  for (const [name, value] of Object.entries(updates)) {
    const field = config.fields.find((item) => item.name === name);
    if (!field || !accepts(field, value))
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.invalidValue",
          "Invalid value for field {name}.",
        ),
        { name: name },
      );
    Object.defineProperty(result, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}
