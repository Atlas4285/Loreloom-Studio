import type { Message } from "../../shared/i18n/message.ts";
import type {
  ModuleContext,
  ModuleSettings,
} from "../../shared/contracts/module.ts";
import type {
  SettingsDefinition,
  SettingsField,
  SettingsGroup,
  SettingsValues,
} from "../../shared/contracts/settings.ts";
import {
  isJsonValue,
  type JsonValue,
} from "../../shared/contracts/services.ts";

function json(value: unknown): JsonValue {
  const result: unknown = JSON.parse(JSON.stringify(value));
  if (!isJsonValue(result)) throw new Error("Invalid settings message.");
  return result;
}

export function connectSettingsPanel(
  context: ModuleContext,
  settings: ModuleSettings,
  definition: SettingsDefinition,
  title: Message,
  isActive: () => boolean,
): () => void {
  // Feature scripts supply localized fallbacks for independently built panels.
  const displayMessage = (source: Message): Message => ({
    key: source.key,
    text: context.translate(source),
  });
  function displayFields(fields: SettingsField[]): SettingsField[] {
    return fields.map((field) => {
      const displayed = {
        ...field,
        label: displayMessage(field.label),
        ...(field.description
          ? { description: displayMessage(field.description) }
          : {}),
      };
      if (displayed.type === "group")
        return { ...displayed, fields: displayFields(displayed.fields) };
      if ("options" in displayed)
        return {
          ...displayed,
          options: displayed.options.map((option) => ({
            ...option,
            label: displayMessage(option.label),
          })),
        };
      if (
        (displayed.type === "text" || displayed.type === "textarea") &&
        displayed.placeholder
      )
        return {
          ...displayed,
          placeholder: displayMessage(displayed.placeholder),
        };
      return displayed;
    });
  }
  const service = `${context.moduleId}-settings`;
  const scope = JSON.stringify(context.scope);
  const groupId = context.moduleId;
  let connected = "";
  let pending = false;
  let dirty = false;
  let alive = true;
  function identity() {
    return { groupId, scope, generation: context.generation };
  }
  function snapshot() {
    return { ...identity(), snapshot: settings.read() };
  }
  const release = context.services.provide(
    service,
    async (method, payload, request) => {
      const panel = context.services.find("settings-panel");
      if (
        !alive ||
        !isActive() ||
        !panel ||
        request.sender !== panel.instanceId ||
        request.generation !== panel.generation
      )
        throw new Error("Settings panel is not the active provider.");
      request.signal.throwIfAborted();
      if (
        !payload ||
        typeof payload !== "object" ||
        Array.isArray(payload) ||
        payload.groupId !== groupId ||
        payload.scope !== scope ||
        payload.generation !== context.generation
      )
        throw new Error("Settings context has changed.");
      if (method === "read") return json(snapshot());
      if (method === "action") {
        if (
          typeof payload.id !== "string" ||
          typeof payload.value !== "string" ||
          !Number.isSafeInteger(payload.expectedRevision)
        )
          throw new Error("Invalid settings action.");
        const next = await settings.action(
          payload.id,
          payload.value,
          Number(payload.expectedRevision),
        );
        request.signal.throwIfAborted();
        return json({ ...identity(), snapshot: next });
      }
      if (
        method !== "update" ||
        !Number.isSafeInteger(payload.expectedRevision) ||
        !payload.values ||
        typeof payload.values !== "object" ||
        Array.isArray(payload.values)
      )
        throw new Error("Invalid settings update.");
      settings.update(
        payload.values as SettingsValues,
        Number(payload.expectedRevision),
      );
      await settings.flush?.();
      request.signal.throwIfAborted();
      return json(snapshot());
    },
  );
  function publish(): void {
    if (!alive || context.signal.aborted) return;
    try {
      if (JSON.stringify(context.host.scope()) !== scope) return;
    } catch {
      return;
    }
    const panel = context.services.find("settings-panel");
    const key = panel ? `${panel.instanceId}:${panel.generation}` : "";
    if (!panel || !isActive()) {
      if (connected && panel)
        void context.services
          .request(
            "settings-panel",
            "unregister",
            json({ ...identity(), instanceId: context.instanceId }),
          )
          .catch(() => {});
      connected = "";
      return;
    }
    if (pending) {
      dirty = true;
      return;
    }
    pending = true;
    dirty = false;
    void context.services
      .request(
        "settings-panel",
        "register",
        json({
          ...identity(),
          instanceId: context.instanceId,
          moduleId: context.moduleId,
          title: displayMessage(title),
          fields: displayFields(definition.fields),
          snapshot: settings.read(),
          endpoint: { service, protocol: 1 },
        } satisfies SettingsGroup),
      )
      .then(() => {
        if (alive) {
          connected = key;
          const current = context.signal.aborted
            ? undefined
            : context.services.find("settings-panel");
          if (
            !isActive() ||
            !current ||
            `${current.instanceId}:${current.generation}` !== key
          )
            dirty = true;
        }
      })
      .catch((error: unknown) => {
        connected = "";
        if (alive && !context.signal.aborted)
          console.warn("Could not register settings group.", error);
      })
      .finally(() => {
        pending = false;
        if (dirty && alive) publish();
      });
  }
  const unsubscribe = context.services.subscribe(() => {
    const panel = context.services.find("settings-panel");
    if (
      !isActive() ||
      `${panel?.instanceId ?? ""}:${panel?.generation ?? ""}` !== connected
    )
      publish();
  });
  const unwatch = settings.subscribe(() => publish());
  // Renew registration even when the panel instance has not changed: its
  // registry can have pruned this group during a transient endpoint outage.
  context.lifecycle.interval(publish, 5000);
  publish();
  const dispose = () => {
    if (!alive) return;
    // The bridge may already be aborting; withdraw still removes the endpoint.
    if (!context.signal.aborted && connected)
      void context.services
        .request(
          "settings-panel",
          "unregister",
          json({ ...identity(), instanceId: context.instanceId }),
        )
        .catch(() => {});
    alive = false;
    unsubscribe();
    unwatch();
    release();
  };
  context.lifecycle.defer(dispose);
  return publish;
}
