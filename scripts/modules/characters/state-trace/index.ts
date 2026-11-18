import type { ModuleSetup } from "../../../../shared/contracts/module.ts";
import { createOwnership } from "../../../runtime/module-ownership.ts";
import { connectSettingsPanel } from "../../../runtime/settings-panel.ts";
import { createStateHost } from "./runtime/host.ts";
import { createSettings, title } from "./settings/index.ts";
import { createConfigStore } from "./settings/config-store.ts";
import { createStateStore } from "./state/store.ts";
import { createHistory } from "./state/history.ts";
import { createGeneration } from "./state/generation.ts";
import { createPersistence } from "./state/persistence.ts";
import { errorText } from "./domain/errors.ts";
import { createModel } from "./model/integration.ts";
import { createEditor, type StateEditor } from "./ui/editor.ts";
import { createPanel, type StatePanel } from "./ui/panel.ts";
import { observeMessages } from "./runtime/events.ts";
import css from "./ui/styles.css?raw";
const setup: ModuleSetup = async (context) => {
  const host = createStateHost(context);
  const ownership = createOwnership(context, "state-trace");
  const style = context.host.document.createElement("style");
  style.textContent = css;
  context.host.document.head.append(style);
  context.lifecycle.defer(() => style.remove());
  let editor: StateEditor | undefined;
  let panel: StatePanel | undefined;
  let frame = 0;
  let initializationAlert: HTMLElement | undefined;
  let removeAlertTheme: (() => void) | undefined;
  const clearError = () => {
    initializationAlert?.remove();
    initializationAlert = undefined;
    removeAlertTheme?.();
    removeAlertTheme = undefined;
  };
  context.lifecycle.defer(clearError);
  const showError = (error: unknown) => {
    if (!ownership.isActive() || !host.isCurrent()) return;
    clearError();
    initializationAlert = context.host.document.createElement("p");
    initializationAlert.className = "state-trace__initialization-error";
    initializationAlert.setAttribute("role", "alert");
    initializationAlert.textContent = errorText(context, error);
    removeAlertTheme = context.theme.mount(initializationAlert);
    (
      context.host.document.querySelector("#qr--bar") ??
      context.host.document.querySelector("#chat") ??
      context.host.document.body
    ).append(initializationAlert);
  };
  const persistence = createPersistence(context, host, ownership.isActive);
  let config: ReturnType<typeof createConfigStore>;
  try {
    config = createConfigStore(context, host, persistence);
  } catch (error) {
    showError(error);
    console.error("Could not restore state trace configuration.", error);
    return;
  }
  const { settings, definition } = createSettings(context, config, () =>
    editor?.open(),
  );
  const store = createStateStore(
    context,
    host,
    ownership.isActive,
    config.getConfig,
    persistence,
  );
  const generation = createGeneration(context, host, store, ownership.isActive);
  const history = createHistory(host, store);
  const model = createModel(
    context,
    host,
    generation,
    config.getConfig,
    ownership.isActive,
  );
  const refresh = () => {
    if (frame || context.signal.aborted) return;
    frame = context.host.window.requestAnimationFrame(() => {
      frame = 0;
      if (context.signal.aborted) return;
      try {
        panel?.render(config.getConfig());
      } catch (error) {
        console.error("Could not render state trace.", error);
      }
    });
  };
  const stateChanged = () => {
    if (!ownership.isActive() || !host.isCurrent()) return;
    model.refreshPrompt();
    refresh();
  };
  const synchronize = async (force = false, before = generation.limit()) => {
    if (config.isSaving()) return;
    await config.initialize();
    if (!ownership.isActive() || !host.isCurrent()) return;
    const changed = history.sync(config.getConfig(), before);
    if (changed || force) await store.persist();
  };
  const saveHistory = () => {
    void synchronize()
      .catch((error) => console.error("Could not save state history.", error))
      .finally(stateChanged);
  };
  editor = createEditor(
    context,
    config,
    generation.generating,
    ownership.isActive,
    refresh,
  );
  panel = createPanel(
    context,
    host,
    store,
    generation.generating,
    ownership.isActive,
    stateChanged,
  );
  const publish = connectSettingsPanel(
    context,
    settings,
    definition,
    title,
    ownership.isActive,
  );
  let previousFields = JSON.stringify(config.getConfig().fields);
  const changed = () => {
    if (!ownership.isActive()) return;
    const current = config.getConfig();
    const fields = JSON.stringify(current.fields);
    if (fields !== previousFields || !current.enabled) generation.cancelRound();
    previousFields = fields;
    saveHistory();
    model.register();
    publish();
    refresh();
  };
  context.lifecycle.defer(config.subscribe(changed));
  context.lifecycle.defer(
    persistence.subscribe(() => {
      if (!persistence.saveFailed()) clearError();
      refresh();
    }),
  );
  const sync = async () => {
    if (ownership.isActive()) {
      try {
        await synchronize();
        if (!ownership.isActive() || !host.isCurrent()) return;
        model.register();
        refresh();
      } catch (error) {
        showError(error);
        console.error("Could not save state trace configuration.", error);
        model.clear();
        refresh();
      }
    } else {
      generation.cancelRound();
      model.clear();
      panel?.clear();
      editor?.close();
    }
    publish();
  };
  ownership.subscribe(() => {
    void sync();
  });
  const subscribe = (
    name: string,
    callback: (...args: unknown[]) => void | Promise<void>,
  ) =>
    context.lifecycle.defer(
      context.host.subscribe(name, async (...args) => {
        if (!ownership.isActive() || !host.isCurrent()) return;
        try {
          await callback(...args);
        } catch (error) {
          console.error("Could not update state history.", error);
        } finally {
          stateChanged();
        }
      }),
    );
  subscribe("GENERATION_AFTER_COMMANDS", async (type, _options, dryRun) => {
    if (dryRun === true || type === "quiet" || type === "impersonate") return;
    await config.initialize();
    const changed = history.sync(config.getConfig(), generation.limit());
    generation.beginRound(
      config.getConfig(),
      typeof type === "string" ? type : undefined,
      false,
    );
    stateChanged();
    if (changed) return store.persist().then(() => {});
  });
  subscribe("MESSAGE_SENT", async (id) => {
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) return;
    generation.sent(id);
    await synchronize(false, id + 1);
  });
  subscribe("TOOL_CALLS_PERFORMED", async (invocations) => {
    await generation.toolsPerformed(invocations);
    await synchronize();
  });
  subscribe("MESSAGE_RECEIVED", async (id) => {
    if (typeof id === "number") await generation.receive(id);
    await synchronize();
  });
  for (const event of ["GENERATION_ENDED", "GENERATION_STOPPED"])
    subscribe(event, async () => {
      await generation.finishRound();
      await synchronize();
    });
  for (const event of [
    "MESSAGE_SWIPED",
    "MESSAGE_DELETED",
    "MESSAGE_UPDATED",
    "MESSAGE_EDITED",
    "MORE_MESSAGES_LOADED",
    "CHAT_LOADED",
  ])
    subscribe(event, async () => {
      generation.historyChanged(
        event === "MESSAGE_DELETED" || event === "MESSAGE_SWIPED",
      );
      await synchronize(
        event === "MESSAGE_DELETED" || event === "MESSAGE_SWIPED",
      );
    });
  subscribe("CHARACTER_MESSAGE_RENDERED", refresh);
  observeMessages(context, refresh);
  context.lifecycle.defer(() =>
    context.host.window.cancelAnimationFrame(frame),
  );
  await sync();
};
export default setup;
