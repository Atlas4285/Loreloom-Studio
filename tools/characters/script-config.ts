import { validateConfig } from "../../scripts/modules/characters/state-trace/domain/config.ts";
import { StateError } from "../../scripts/modules/characters/state-trace/domain/errors.ts";

export function selectCharacterScripts(
  configured: string[],
  additional: string | undefined,
  available: readonly string[],
): string[] {
  const extra =
    additional === undefined || additional === "none"
      ? []
      : additional.split(",").map((id) => id.trim());
  if (new Set(extra).size !== extra.length)
    throw new Error("Script IDs must be distinct.");
  for (const id of [...configured, ...extra])
    if (!available.includes(id))
      throw new Error(`Unknown or non-character script: ${id}`);
  return additional === "none" ? [] : [...new Set([...configured, ...extra])];
}

export function createScriptData(
  id: string,
  value: unknown,
): Record<string, unknown> {
  if (!["state-trace", "random-integer"].includes(id))
    throw new Error(`Unsupported character script configuration: ${id}`);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Script configuration must be an object.");
  if (Object.keys(value).length === 0) return {};
  if (id === "random-integer")
    throw new Error(
      "random-integer currently accepts an empty configuration: {}.",
    );
  try {
    const config = validateConfig(value);
    for (const key of Object.keys(config))
      if (!["enabled", "fields", "prompt", "toolDescription"].includes(key))
        throw new Error(`Unknown configuration property: ${key}`);
    return { "loreloom.state-trace.template": { version: 1, config } };
  } catch (error) {
    const detail =
      error instanceof StateError
        ? error.source.text.replace(/\{(\w+)\}/g, (match, key: string) =>
            Object.hasOwn(error.values, key)
              ? String(error.values[key])
              : match,
          )
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(detail);
  }
}
