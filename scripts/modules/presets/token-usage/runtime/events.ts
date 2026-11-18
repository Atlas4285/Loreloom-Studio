import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { UsageTracker } from "../usage/tracker.ts";
import type { UsageHistory } from "../usage/history.ts";
export function bindEvents(
  context: ModuleContext,
  tracker: UsageTracker,
  history: UsageHistory,
  isActive: () => boolean,
  render: () => void,
) {
  const subscribe = (name: string, callback: (...args: unknown[]) => void) =>
    context.lifecycle.defer(
      context.host.subscribe(name, (...args) => {
        if (isActive()) callback(...args);
      }),
    );
  subscribe("GENERATION_AFTER_COMMANDS", (type, _options, dryRun) => {
    if (dryRun === true) return;
    tracker.start(typeof type === "string" ? type : undefined, false);
    if (type === "quiet" || type === "impersonate") return;
    history.clear();
    render();
  });
  subscribe("GENERATE_AFTER_DATA", (data, dryRun) => {
    tracker.capturePrompt(data, dryRun === true);
  });
  subscribe("MESSAGE_RECEIVED", (id, type) => {
    if (typeof id === "number") tracker.received(id, type);
    render();
    history.refresh();
  });
  subscribe("TOOL_CALLS_PERFORMED", (invocations) => {
    tracker.toolsPerformed(invocations);
    history.clear();
    render();
    history.refresh();
  });
  subscribe("TOOL_CALLS_RENDERED", () => {
    render();
    history.refresh();
  });
  for (const event of ["GENERATION_ENDED", "GENERATION_STOPPED"])
    subscribe(event, () => {
      tracker.end();
      render();
      history.refresh();
    });
  for (const event of [
    "CHARACTER_MESSAGE_RENDERED",
    "MESSAGE_UPDATED",
    "MESSAGE_EDITED",
    "MESSAGE_SWIPED",
    "MESSAGE_DELETED",
    "MORE_MESSAGES_LOADED",
    "CHAT_LOADED",
    "ITEMIZED_PROMPTS_SAVED",
    "ITEMIZED_PROMPTS_LOADED",
    "SETTINGS_UPDATED",
  ])
    subscribe(event, (id, type) => {
      tracker.historyChanged();
      if (event === "CHARACTER_MESSAGE_RENDERED" && typeof id === "number")
        tracker.received(id, type);
      history.clear();
      render();
      history.refresh();
    });
  const Observer = (
    context.host.window as unknown as {
      MutationObserver: typeof MutationObserver;
    }
  ).MutationObserver;
  const observer = new Observer((records) => {
    if (!isActive()) return;
    if (
      records.some((record) => {
        const target =
          record.target.nodeType === 1
            ? (record.target as Element)
            : record.target.parentElement;
        if (target?.closest(".loreloom-token-usage")) return false;
        if (record.type === "attributes")
          return (
            record.attributeName === "data-loreloom-settings-entry" ||
            !!target?.matches("#chat, .mes, .mes_text")
          );
        if (!target?.closest("#chat"))
          return (
            !!target?.closest("[data-loreloom-settings-entry]") ||
            [...record.addedNodes, ...record.removedNodes].some(
              (node) =>
                node.nodeType === 1 &&
                ((node as Element).matches(
                  "#chat, #qr--bar, [data-loreloom-settings-entry], .loreloom-font-status",
                ) ||
                  !!(node as Element).querySelector(
                    "#chat, #qr--bar, [data-loreloom-settings-entry], .loreloom-font-status",
                  )),
            )
          );
        return [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            node.nodeType !== 1 ||
            !(node as Element).classList.contains("loreloom-token-usage"),
        );
      })
    ) {
      render();
      if (
        records.some((record) =>
          [...record.addedNodes].some(
            (node) =>
              node.nodeType === 1 &&
              ((node as Element).matches("#chat, .mes[mesid]") ||
                !!(node as Element).querySelector(".mes[mesid]")),
          ),
        )
      )
        history.refresh();
    }
  });
  context.lifecycle.observe(observer, context.host.document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-loreloom-settings-entry", "style", "class"],
  });
  const generating = new Observer(() => {
    if (isActive()) render();
  });
  context.lifecycle.observe(generating, context.host.document.body, {
    attributes: true,
    attributeFilter: ["data-generating"],
  });
  const stop = context.host.document.querySelector("#mes_stop");
  if (stop)
    context.lifecycle.observe(generating, stop, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
    });
}
