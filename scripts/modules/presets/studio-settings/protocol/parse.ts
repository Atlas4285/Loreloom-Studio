import type { JsonValue } from "../../../../../shared/contracts/services.ts";
import { isMessage } from "../../../../../shared/i18n/message.ts";
import {
  validateSettings,
  validateValues,
  valueFields,
  type SettingsGroup,
  type SettingsSnapshot,
} from "../../../../../shared/contracts/settings.ts";
import { validateResources } from "../../../../../shared/contracts/resources.ts";
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function snapshot(
  value: unknown,
  group: Pick<SettingsGroup, "fields">,
): SettingsSnapshot {
  if (
    !record(value) ||
    !Number.isSafeInteger(value.version) ||
    Number(value.version) < 1 ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0
  )
    throw new Error("Invalid settings snapshot.");
  return {
    version: Number(value.version),
    revision: Number(value.revision),
    values: validateValues(group.fields, value.values),
    ...(value.resources === undefined
      ? {}
      : {
          resources: validateResources(
            value.resources,
            valueFields(group.fields)
              .filter((field) => field.type === "resource")
              .map((field) => field.id),
          ),
        }),
  };
}
export function parseGroup(value: JsonValue): SettingsGroup {
  if (
    !record(value) ||
    typeof value.instanceId !== "string" ||
    !value.instanceId ||
    typeof value.moduleId !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(value.moduleId) ||
    typeof value.groupId !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(value.groupId) ||
    typeof value.scope !== "string" ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 1 ||
    !isMessage(value.title) ||
    !Array.isArray(value.fields) ||
    !record(value.endpoint) ||
    value.endpoint.service !== `${value.moduleId}-settings` ||
    value.endpoint.protocol !== 1
  )
    throw new Error("Invalid settings registration.");
  const group = value as unknown as SettingsGroup;
  validateSettings({
    version: record(value.snapshot) ? Number(value.snapshot.version) : NaN,
    fields: group.fields,
  });
  const state = snapshot(value.snapshot, group);
  return structuredClone({ ...group, snapshot: state });
}
export function identity(group: SettingsGroup) {
  return {
    groupId: group.groupId,
    scope: group.scope,
    generation: group.generation,
  };
}
export function parseReply(
  value: JsonValue,
  group: SettingsGroup,
): SettingsSnapshot {
  if (
    !record(value) ||
    value.groupId !== group.groupId ||
    value.scope !== group.scope ||
    value.generation !== group.generation
  )
    throw new Error("Settings context has changed.");
  const next = snapshot(value.snapshot, group);
  if (
    next.version !== group.snapshot.version ||
    next.revision < group.snapshot.revision
  )
    throw new Error("Stale settings response.");
  return next;
}
