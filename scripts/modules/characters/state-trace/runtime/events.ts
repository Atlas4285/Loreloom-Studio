import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
export function observeMessages(
  context: ModuleContext,
  refresh: () => void,
): void {
  const Observer = (
    context.host.window as unknown as {
      MutationObserver: typeof MutationObserver;
    }
  ).MutationObserver;
  const observer = new Observer((records) => {
    if (
      records.some((record) => {
        const target =
          record.target.nodeType === 1
            ? (record.target as Element)
            : record.target.parentElement;
        if (target?.closest(".state-trace,.state-trace-editor")) return false;
        if (target?.closest("#chat"))
          return [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node.nodeType !== 1 ||
              !(node as Element).classList.contains("state-trace"),
          );
        return [...record.addedNodes].some(
          (node) =>
            node.nodeType === 1 &&
            ((node as Element).id === "chat" ||
              !!(node as Element).querySelector("#chat")),
        );
      })
    )
      refresh();
  });
  context.lifecycle.observe(observer, context.host.document.body, {
    childList: true,
    subtree: true,
  });
  const generating = new Observer(refresh);
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
