import type { HostAdapter } from "../../shared/host/adapter.ts";
import type { ModuleSettings } from "../../shared/contracts/module.ts";
import type { JsonValue } from "../../shared/contracts/services.ts";
import {
  settingsDefaults,
  validateSettings,
  validateValues,
  valueFields,
  type SettingsDefinition,
  type SettingsField,
  type SettingsSnapshot,
  type SettingsValues,
} from "../../shared/contracts/settings.ts";
import type { Lifecycle } from "./lifecycle.ts";
import { validateResources } from "../../shared/contracts/resources.ts";

export class SettingsService {
  private readonly registered = new Set<string>();
  constructor(
    private readonly host: HostAdapter,
    private readonly lifecycle: Lifecycle,
    private readonly scopeKey: string,
  ) {}
  register(moduleId: string, definition: SettingsDefinition): ModuleSettings {
    this.lifecycle.assertActive();
    if (this.registered.has(moduleId))
      throw new Error(`Settings already registered: ${moduleId}`);
    validateSettings(definition);
    const expectedScope = JSON.stringify(this.host.scope());
    const assertCurrent = () => {
      this.lifecycle.assertActive();
      if (JSON.stringify(this.host.scope()) !== expectedScope)
        throw new Error("Settings context has changed.");
    };
    const key = `loreloom.settings.${encodeURIComponent(this.scopeKey)}.${moduleId}`;
    const defaults = settingsDefaults(definition.fields);
    const listeners = new Set<(snapshot: SettingsSnapshot) => void>();
    const resources = valueFields(definition.fields).filter(
      (field) => field.type === "resource",
    );
    const decode = (stored: unknown): SettingsSnapshot => {
      if (stored === undefined)
        return {
          version: definition.version,
          revision: 0,
          values: structuredClone(defaults),
        };
      if (!stored || typeof stored !== "object" || Array.isArray(stored))
        throw new Error(`Invalid stored settings: ${moduleId}`);
      const value = stored as Record<string, unknown>;
      if (
        !Number.isSafeInteger(value.version) ||
        Number(value.version) < 1 ||
        !Number.isSafeInteger(value.revision) ||
        Number(value.revision) < 0
      )
        throw new Error(`Invalid settings version: ${moduleId}`);
      if (Number(value.version) > definition.version)
        throw new Error(`Settings require a newer module: ${moduleId}`);
      if (value.version !== definition.version) {
        if (!definition.migrate)
          throw new Error(`Settings migration is required: ${moduleId}`);
        return {
          version: definition.version,
          revision: Number(value.revision),
          values: validateValues(
            definition.fields,
            definition.migrate(
              structuredClone(value.values),
              Number(value.version),
            ),
          ),
        };
      }
      return {
        version: definition.version,
        revision: Number(value.revision),
        values: validateValues(definition.fields, value.values),
      };
    };
    const read = (): SettingsSnapshot => {
      assertCurrent();
      const snapshot = decode(this.host.read(key));
      if (definition.resources)
        snapshot.resources = validateResources(
          definition.resources(),
          resources.map((field) => field.id),
        );
      return snapshot;
    };
    read();
    this.registered.add(moduleId);
    this.lifecycle.defer(() => {
      listeners.clear();
      this.registered.delete(moduleId);
    });
    const notify = () => {
      const snapshot = read();
      for (const listener of listeners) {
        try {
          listener(structuredClone(snapshot));
        } catch (error) {
          console.error("Settings listener failed.", error);
        }
      }
    };
    if (definition.subscribeResources)
      this.lifecycle.defer(definition.subscribeResources(notify));
    return {
      read,
      action: async (id: string, value: string, expectedRevision: number) => {
        assertCurrent();
        const find = (fields: SettingsField[]): SettingsField | undefined => {
          for (const field of fields) {
            if (field.id === id) return field;
            if (field.type === "group") {
              const nested = find(field.fields);
              if (nested) return nested;
            }
          }
          return undefined;
        };
        const field = find(definition.fields);
        const state = read().resources?.[id];
        const actions = state
          ? [
              state.action,
              state.onOpen,
              ...state.options.flatMap((option) => option.actions ?? []),
            ]
          : [];
        const allowed =
          field?.type === "buttons"
            ? field.options.some((option) => option.value === value)
            : field?.type === "resource" &&
              actions.some(
                (action) => action?.value === value && !action.disabled,
              );
        if (!allowed || !definition.onAction)
          throw new Error("Unknown settings action.");
        if (read().revision !== expectedRevision)
          throw new Error(
            "Settings revision conflict. Reload before running the action.",
          );
        await definition.onAction(id, value, this.lifecycle.signal);
        assertCurrent();
        return read();
      },
      update: (values: SettingsValues, expectedRevision: number) => {
        this.lifecycle.assertActive();
        const current = read();
        if (current.revision !== expectedRevision)
          throw new Error("Settings revision conflict. Reload before saving.");
        const next = {
          version: definition.version,
          revision: current.revision + 1,
          values: validateValues(definition.fields, values),
        };
        for (const field of resources)
          if (
            next.values[field.id] !== current.values[field.id] &&
            !current.resources?.[field.id]?.options.some(
              (option) =>
                option.value === next.values[field.id] && option.available,
            )
          )
            throw new Error(`Resource is not available: ${field.id}`);
        this.host.write(key, next as unknown as JsonValue);
        notify();
        return read();
      },
      subscribe: (callback) => {
        this.lifecycle.assertActive();
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    };
  }
}
