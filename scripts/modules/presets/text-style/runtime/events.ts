import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
export function bindEvents(context: ModuleContext, refresh: () => void): void {
  for (const event of [
    "USER_MESSAGE_RENDERED",
    "CHARACTER_MESSAGE_RENDERED",
    "MESSAGE_SENT",
    "MESSAGE_RECEIVED",
    "MESSAGE_UPDATED",
    "MESSAGE_EDITED",
    "MESSAGE_SWIPED",
    "MESSAGE_DELETED",
    "MORE_MESSAGES_LOADED",
    "CHAT_LOADED",
    "SETTINGS_UPDATED",
  ])
    context.lifecycle.defer(context.host.subscribe(event, refresh));
  // Some host versions do not expose a separate tool rendering event.
  try {
    context.lifecycle.defer(
      context.host.subscribe("TOOL_CALLS_RENDERED", refresh),
    );
  } catch {
    /* DOM observation also handles tool calls. */
  }
  const globals = context.host.window as unknown as {
    MutationObserver: typeof MutationObserver;
    ResizeObserver?: typeof ResizeObserver;
  };
  const observer = new globals.MutationObserver((records) => {
    if (
      records.some((record) => {
        const target =
          record.target.nodeType === 1
            ? (record.target as Element)
            : record.target.parentElement;
        if (
          target?.closest(
            ".loreloom-text-style__background, .loreloom-text-style__extra-icon",
          )
        )
          return false;
        if (!target?.closest("#chat"))
          return [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node.nodeType === 1 &&
              ((node as Element).id === "chat" ||
                !!(node as Element).querySelector("#chat")),
          );
        if (record.type === "characterData") return true;
        return [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            node.nodeType !== 1 ||
            !(node as Element).matches(
              ".loreloom-text-style__background, .loreloom-text-style__extra-icon",
            ),
        );
      })
    )
      refresh();
  });
  context.lifecycle.observe(observer, context.host.document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  const generation = new globals.MutationObserver(refresh);
  context.lifecycle.observe(generation, context.host.document.body, {
    attributes: true,
    attributeFilter: ["data-generating"],
  });
  const stop = context.host.document.querySelector("#mes_stop");
  if (stop)
    context.lifecycle.observe(generation, stop, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
    });
  if (globals.ResizeObserver) {
    const widths = new WeakMap<Element, number>();
    const resize = new globals.ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        if (widths.get(entry.target) !== entry.contentRect.width)
          changed = true;
        widths.set(entry.target, entry.contentRect.width);
      }
      if (changed) refresh();
    });
    resize.observe(context.host.document.body);
    const chat = context.host.document.querySelector("#chat");
    if (chat) resize.observe(chat);
    context.lifecycle.defer(() => resize.disconnect());
  }
  context.lifecycle.listen(context.host.window, "resize", refresh);
}
