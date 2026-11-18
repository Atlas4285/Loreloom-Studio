import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { NextActionsRenderer } from "../ui/renderer.ts";

export function bindEvents(
  context: ModuleContext,
  renderer: NextActionsRenderer,
): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame || context.signal.aborted) return;
    frame = context.host.window.requestAnimationFrame(() => {
      frame = 0;
      if (context.signal.aborted) return;
      try {
        renderer.renderAll();
      } catch (error) {
        console.error("Could not render next actions.", error);
      }
    });
  };
  context.lifecycle.defer(() =>
    context.host.window.cancelAnimationFrame(frame),
  );
  for (const event of [
    "CHARACTER_MESSAGE_RENDERED",
    "MORE_MESSAGES_LOADED",
    "MESSAGE_SENT",
    "MESSAGE_RECEIVED",
    "MESSAGE_DELETED",
    "MESSAGE_UPDATED",
    "MESSAGE_EDITED",
    "MESSAGE_SWIPED",
  ]) {
    context.lifecycle.defer(context.host.subscribe(event, schedule));
  }
  context.lifecycle.defer(
    context.host.subscribe("GENERATION_STARTED", (_type, _options, dryRun) => {
      if (dryRun === true) return;
      renderer.generating(true);
      schedule();
    }),
  );
  for (const event of ["GENERATION_ENDED", "GENERATION_STOPPED"])
    context.lifecycle.defer(
      context.host.subscribe(event, () => {
        renderer.generating(false);
        schedule();
      }),
    );
  // Watch host re-rendering without writing source messages or reacting to attributes.
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) => {
        const element =
          record.target.nodeType === 1
            ? (record.target as Element)
            : record.target.parentElement;
        return (
          !!element?.closest("#chat") ||
          [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node.nodeType === 1 &&
              ((node as Element).id === "chat" ||
                !!(node as Element).querySelector?.("#chat")),
          )
        );
      })
    )
      schedule();
  });
  context.lifecycle.observe(observer, context.host.document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  // Real host state also changes outside generation events, including early exits.
  const generationObserver = new MutationObserver(schedule);
  context.lifecycle.observe(generationObserver, context.host.document.body, {
    attributes: true,
    attributeFilter: ["data-generating"],
  });
  const stop = context.host.document.querySelector("#mes_stop");
  if (stop)
    context.lifecycle.observe(generationObserver, stop, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
    });
  schedule();
  return schedule;
}
