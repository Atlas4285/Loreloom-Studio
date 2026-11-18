import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
export function createGeneration(context: ModuleContext, refresh: () => void) {
  let start = -1;
  let ignored = false;
  context.lifecycle.defer(
    context.host.subscribe(
      "GENERATION_AFTER_COMMANDS",
      (type, _options, dryRun) => {
        if (dryRun === true) return;
        ignored = type === "quiet" || type === "impersonate";
        const count = context.host.messages().length;
        start = ignored
          ? -1
          : ["swipe", "regenerate", "continue", "append"].includes(String(type))
            ? count - 1
            : count;
        refresh();
      },
    ),
  );
  for (const event of ["GENERATION_ENDED", "GENERATION_STOPPED"])
    context.lifecycle.defer(
      context.host.subscribe(event, () => {
        start = -1;
        ignored = false;
        refresh();
      }),
    );
  return (id: number) =>
    !ignored &&
    context.host.isGenerating() &&
    id === context.host.messages().length - 1 &&
    (start < 0 || id >= start);
}
