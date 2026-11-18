import { StateError } from "../domain/errors.ts";
import { message } from "../../../../../shared/i18n/message.ts";
import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { JsonValue } from "../../../../../shared/contracts/services.ts";
import { reconcile, validateConfig, type Config } from "../domain/config.ts";
import { DEFAULT_PROMPT, isDefaultPrompt } from "../domain/prompt.ts";
import {
  DEFAULT_TOOL_DESCRIPTION,
  isDefaultToolDescription,
} from "../domain/tool.ts";
import type { StateHost } from "../runtime/host.ts";
import {
  ARCHIVE_KEY,
  invalidConfig,
  readArchive,
  type StateArchive,
} from "../state/archive.ts";
import type { StatePersistence } from "../state/persistence.ts";

interface Configuration {
  revision: number;
  config: Config;
}
export function createConfigStore(
  context: ModuleContext,
  host: StateHost,
  persistence: StatePersistence,
) {
  const defaultsKey = `loreloom.state-trace.config.${encodeURIComponent(context.scope.characterId!)}`;
  const listeners = new Set<() => void>();
  let staged:
    { config: Config; revision: number; previous: Configuration } | undefined;
  let initial: Config | undefined;
  let initializing: Promise<void> | undefined;
  function assertCurrent(): void {
    context.signal.throwIfAborted();
    host.assertCurrent();
  }
  function complete(value: unknown): Config {
    const config = validateConfig(value);
    return {
      enabled: config.enabled,
      fields: config.fields,
      prompt: config.prompt?.trim()
        ? config.prompt
        : context.translate(DEFAULT_PROMPT),
      toolDescription: config.toolDescription?.trim()
        ? config.toolDescription
        : context.translate(DEFAULT_TOOL_DESCRIPTION),
    };
  }
  function seed(): Config {
    if (initial) return structuredClone(initial);
    const saved = context.host.read(defaultsKey) as
      { version?: unknown; config?: unknown } | undefined;
    const template =
      saved ??
      (context.host.read("loreloom.state-trace.template") as
        { version?: unknown; config?: unknown } | undefined);
    if (template !== undefined && template.version !== 1) throw invalidConfig();
    const config = validateConfig(
      template?.config ?? { enabled: true, fields: [] },
    );
    if (isDefaultPrompt(config.prompt)) delete config.prompt;
    if (isDefaultToolDescription(config.toolDescription))
      delete config.toolDescription;
    initial = complete(config);
    return structuredClone(initial);
  }
  function rememberDefaults(config: Config): void {
    assertCurrent();
    context.host.write(defaultsKey, {
      version: 1,
      config: structuredClone(config),
    } as unknown as JsonValue);
  }
  function read(): Configuration {
    assertCurrent();
    const archive = readArchive(host);
    if (archive?.config === undefined) return { revision: 0, config: seed() };
    const validated = validateConfig(archive.config);
    if (
      !Number.isSafeInteger(archive.configRevision) ||
      Number(archive.configRevision) < 1 ||
      typeof validated.prompt !== "string" ||
      typeof validated.toolDescription !== "string"
    )
      throw invalidConfig();
    if (
      staged &&
      archive.config === staged.config &&
      archive.configRevision === staged.revision
    )
      return structuredClone(staged.previous);
    return { revision: archive.configRevision!, config: complete(validated) };
  }
  function notify(): void {
    if (context.signal.aborted || !host.isCurrent()) return;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error("State configuration listener failed.", error);
      }
    }
  }
  function isPersisted(): boolean {
    assertCurrent();
    return staged
      ? staged.previous.revision > 0
      : readArchive(host)?.config !== undefined;
  }
  async function commit(
    change: (current: Config) => Config,
    expectedRevision: number,
  ): Promise<void> {
    assertCurrent();
    const target = persistence.session();
    if (!target.chatId)
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.openChat",
          "Open a chat before editing state.",
        ),
      );
    let committed = false;
    let ownStage: typeof staged;
    try {
      const saved = await persistence.persist(
        target,
        () => true,
        () => {
          const previous = read();
          if (previous.revision !== expectedRevision)
            throw new StateError(
              message(
                "loreloom.stateTrace.errors.configConflict",
                "State trace configuration changed. Reopen the editor before saving.",
              ),
            );
          const original = readArchive(host);
          const config = complete(change(previous.config));
          const values = reconcile(config, original?.values);
          const next: StateArchive = {
            ...original,
            version: 1,
            config,
            configRevision: previous.revision + 1,
            values,
          };
          staged = { config, revision: next.configRevision!, previous };
          ownStage = staged;
          host.current().chatMetadata[ARCHIVE_KEY] = next;
          return () => {
            const current = readArchive(host);
            if (
              current?.config !== config ||
              current.configRevision !== next.configRevision
            )
              return;
            if (!original && current === next)
              delete host.current().chatMetadata[ARCHIVE_KEY];
            else {
              const restored = {
                ...current,
                config: original?.config,
                configRevision: original?.configRevision,
              };
              if (current.values === values) restored.values = original?.values;
              if (restored.config === undefined) delete restored.config;
              if (restored.configRevision === undefined)
                delete restored.configRevision;
              if (restored.values === undefined) delete restored.values;
              host.current().chatMetadata[ARCHIVE_KEY] = restored;
            }
          };
        },
      );
      if (!saved)
        throw new StateError(
          message(
            "loreloom.stateTrace.errors.contextChanged",
            "State trace context has changed.",
          ),
        );
      committed = true;
      rememberDefaults(ownStage!.config);
    } catch (error) {
      if (error instanceof StateError) throw error;
      console.warn("Could not persist state configuration.", error);
      throw new StateError(
        message(
          "loreloom.stateTrace.errors.saveConfigFailed",
          "Could not save state trace configuration. Your changes have not been saved; try again.",
        ),
      );
    } finally {
      if (staged === ownStage) staged = undefined;
      if (committed) notify();
    }
  }
  // Validate the archive before any state reconciliation or template access.
  read();
  context.lifecycle.defer(() => listeners.clear());
  return {
    getConfig: () => read().config,
    revision: () => read().revision,
    isPersisted,
    isSaving: () => staged !== undefined,
    initialize: async () => {
      if (initializing) return initializing;
      if (staged) await persistence.flush();
      assertCurrent();
      if (host.current().chatId && !isPersisted()) {
        initializing = commit((config) => config, 0);
        try {
          await initializing;
        } finally {
          initializing = undefined;
        }
      } else if (
        host.current().chatId &&
        context.host.read(defaultsKey) === undefined
      ) {
        // Restoring an archived chat can also seed a separately imported script.
        // Never copy live values or replace newer defaults by opening an old chat.
        rememberDefaults(read().config);
      }
    },
    saveConfig: (value: Config, expectedRevision: number) => {
      const fields = validateConfig(value).fields;
      return commit((config) => ({ ...config, fields }), expectedRevision);
    },
    updateSettings: (
      value: Pick<Config, "enabled" | "prompt" | "toolDescription">,
      expectedRevision: number,
    ) => commit((config) => ({ ...config, ...value }), expectedRevision),
    subscribe: (callback: () => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
}
export type ConfigStore = ReturnType<typeof createConfigStore>;
