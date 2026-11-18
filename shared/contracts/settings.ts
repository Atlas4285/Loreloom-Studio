import { isMessage, type Message } from "../i18n/message.ts";
import type { ServiceDeclaration } from "./services.ts";
import type { ResourceStates } from "./resources.ts";
export type SettingValue = string | number | boolean | string[];
export type SettingsValues = Record<string, SettingValue>;
interface FieldBase {
  id: string;
  label: Message;
  description?: Message;
}
interface Choice {
  value: string;
  label: Message;
}
export type SettingsField =
  | (FieldBase & { type: "group"; expanded?: boolean; fields: SettingsField[] })
  | (FieldBase & { type: "boolean"; default: boolean })
  | (FieldBase & { type: "resource"; default: string })
  | (FieldBase & {
      type: "text" | "textarea";
      default: string;
      placeholder?: Message;
      maxLength?: number;
      rows?: number;
    })
  | (FieldBase & {
      type: "number" | "range";
      default: number;
      min?: number;
      max?: number;
      step?: number;
      integer?: boolean;
    })
  | (FieldBase & {
      type: "select" | "radio";
      default: string;
      options: Choice[];
    })
  | (FieldBase & { type: "buttons"; options: Choice[] })
  | (FieldBase & { type: "multiselect"; default: string[]; options: Choice[] });
export type ValueField = Exclude<SettingsField, { type: "group" | "buttons" }>;
export interface SettingsDefinition {
  version: number;
  fields: SettingsField[];
  migrate?: (values: unknown, previousVersion: number) => SettingsValues;
  resources?: () => ResourceStates;
  subscribeResources?: (notify: () => void) => () => void;
  onAction?: (
    id: string,
    value: string,
    signal: AbortSignal,
  ) => void | Promise<void>;
}
export interface SettingsSnapshot {
  version: number;
  revision: number;
  values: SettingsValues;
  resources?: ResourceStates;
}
export interface SettingsGroup {
  instanceId: string;
  moduleId: string;
  groupId: string;
  generation: number;
  scope: string;
  title: Message;
  endpoint: ServiceDeclaration;
  fields: SettingsField[];
  snapshot: SettingsSnapshot;
}
export function valueFields(fields: SettingsField[]): ValueField[] {
  return fields.flatMap((field) =>
    field.type === "group"
      ? valueFields(field.fields)
      : field.type === "buttons"
        ? []
        : [field],
  );
}
export function settingsDefaults(fields: SettingsField[]): SettingsValues {
  return Object.fromEntries(
    valueFields(fields).map((field) => [
      field.id,
      structuredClone(field.default),
    ]),
  );
}
export function validateValues(
  fields: SettingsField[],
  value: unknown,
): SettingsValues {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Settings must be an object.");
  const data = value as Record<string, unknown>;
  const result: SettingsValues = {};
  const leaves = valueFields(fields);
  for (const field of leaves) {
    const item = data[field.id];
    let valid = false;
    switch (field.type) {
      case "boolean":
        valid = typeof item === "boolean";
        break;
      case "resource":
        valid =
          typeof item === "string" && /^[a-z][a-z0-9-]{0,127}$/.test(item);
        break;
      case "text":
      case "textarea":
        valid =
          typeof item === "string" &&
          (field.maxLength === undefined || item.length <= field.maxLength);
        break;
      case "select":
      case "radio":
        valid =
          typeof item === "string" &&
          field.options.some((option) => option.value === item);
        break;
      case "multiselect":
        valid =
          Array.isArray(item) &&
          new Set(item).size === item.length &&
          item.every(
            (value) =>
              typeof value === "string" &&
              field.options.some((option) => option.value === value),
          );
        break;
      case "number":
      case "range":
        valid =
          typeof item === "number" &&
          Number.isFinite(item) &&
          (!field.integer || Number.isInteger(item)) &&
          (field.min === undefined || item >= field.min) &&
          (field.max === undefined || item <= field.max);
        break;
    }
    if (!valid) throw new Error(`Invalid setting: ${field.id}`);
    result[field.id] = structuredClone(item) as SettingValue;
  }
  if (Object.keys(data).some((id) => !leaves.some((field) => field.id === id)))
    throw new Error("Unknown settings field.");
  return result;
}
export function validateSettings(definition: SettingsDefinition): void {
  if (
    !Number.isSafeInteger(definition.version) ||
    definition.version < 1 ||
    !Array.isArray(definition.fields)
  )
    throw new Error("Invalid settings definition.");
  const ids = new Set<string>();
  let count = 0;
  function visit(fields: SettingsField[], depth: number): void {
    if (depth > 8 || !Array.isArray(fields))
      throw new Error("Invalid settings group depth.");
    for (const field of fields) {
      if (
        ++count > 512 ||
        !field ||
        !/^[a-z][a-zA-Z0-9-]*$/.test(field.id) ||
        ids.has(field.id) ||
        !isMessage(field.label) ||
        (field.description !== undefined && !isMessage(field.description))
      )
        throw new Error("Invalid settings field metadata.");
      ids.add(field.id);
      if (field.type === "group") {
        if (field.expanded !== undefined && typeof field.expanded !== "boolean")
          throw new Error("Invalid group state.");
        visit(field.fields, depth + 1);
        continue;
      }
      if (
        ![
          "boolean",
          "resource",
          "text",
          "textarea",
          "number",
          "range",
          "select",
          "radio",
          "buttons",
          "multiselect",
        ].includes(field.type)
      )
        throw new Error("Unknown settings field type.");
      if (field.type === "text" || field.type === "textarea") {
        if (
          (field.rows !== undefined &&
            (field.type !== "textarea" ||
              !Number.isSafeInteger(field.rows) ||
              field.rows < 1 ||
              field.rows > 100)) ||
          (field.placeholder !== undefined && !isMessage(field.placeholder)) ||
          (field.maxLength !== undefined &&
            (!Number.isSafeInteger(field.maxLength) || field.maxLength < 0))
        )
          throw new Error("Invalid text field.");
      }
      if (field.type === "number" || field.type === "range") {
        if (
          (field.min !== undefined && !Number.isFinite(field.min)) ||
          (field.max !== undefined && !Number.isFinite(field.max)) ||
          (field.min !== undefined &&
            field.max !== undefined &&
            field.min > field.max) ||
          (field.step !== undefined &&
            (!Number.isFinite(field.step) || field.step <= 0)) ||
          (field.integer !== undefined && typeof field.integer !== "boolean")
        )
          throw new Error("Invalid numeric field.");
      }
      if (
        ["select", "radio", "buttons", "multiselect"].includes(field.type) &&
        !("options" in field)
      )
        throw new Error("Missing choice options.");
      if (
        "options" in field &&
        (!Array.isArray(field.options) ||
          !field.options.length ||
          new Set(field.options.map((option) => option?.value)).size !==
            field.options.length ||
          field.options.some(
            (option) =>
              !option ||
              typeof option.value !== "string" ||
              !isMessage(option.label),
          ))
      )
        throw new Error("Invalid choice options.");
    }
  }
  visit(definition.fields, 0);
  validateValues(definition.fields, settingsDefaults(definition.fields));
}
