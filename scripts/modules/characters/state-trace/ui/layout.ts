import type { ModuleContext } from "../../../../../shared/contracts/module.ts";

export function alignPanel(
  context: ModuleContext,
  card: HTMLElement,
  block: Element,
): () => void {
  const page = context.host.document;
  const reference =
    page.querySelector(
      '#chat .mes:not([is_system="true"]):not(.smallSysMes):not(.toolCall) .mes_block',
    ) ?? block;
  const view = context.host.window;
  const align = (): void => {
    if (!card.isConnected || context.signal.aborted) return;
    const message = block.closest(".mes");
    const body = (
      message?.matches('[is_system="true"], .smallSysMes, .toolCall')
        ? reference
        : block
    ).querySelector(".mes_text");
    const typography = view.getComputedStyle(body ?? reference);
    for (const [property, value] of [
      ["--state-trace-body-font-family", typography.fontFamily],
      ["--state-trace-body-font-size", typography.fontSize],
      ["--state-trace-body-font-weight", typography.fontWeight],
      [
        "--state-trace-compact-line-height",
        String(
          Math.max(
            1.1,
            (parseFloat(typography.lineHeight) /
              parseFloat(typography.fontSize) || 1.7) * 0.7,
          ),
        ),
      ],
    ] as const)
      if (card.style.getPropertyValue(property) !== value)
        card.style.setProperty(property, value);
    const source = reference.getBoundingClientRect();
    if (!source.width) return;
    const style = view.getComputedStyle(reference);
    const target = view.getComputedStyle(block);
    const pixels = (value: string) => parseFloat(value) || 0;
    const spacing = style.getPropertyValue("--mes-right-spacing").trim();
    const width = Math.max(
      0,
      source.width -
        pixels(style.borderLeftWidth) -
        pixels(style.borderRightWidth) -
        pixels(style.paddingLeft) -
        pixels(style.paddingRight) -
        (spacing ? pixels(spacing) : 30),
    );
    const offset =
      source.left +
      pixels(style.borderLeftWidth) +
      pixels(style.paddingLeft) -
      block.getBoundingClientRect().left -
      pixels(target.borderLeftWidth) -
      pixels(target.paddingLeft);
    card.style.width = `${width}px`;
    card.style.marginLeft = `${offset}px`;
  };
  const Observer = (
    view as unknown as { ResizeObserver: typeof ResizeObserver }
  ).ResizeObserver;
  const observer = new Observer(align);
  for (const element of new Set([
    reference,
    block,
    page.querySelector("#chat"),
  ]))
    if (element) observer.observe(element);
  const Mutation = (
    view as unknown as { MutationObserver: typeof MutationObserver }
  ).MutationObserver;
  const typographyObserver = new Mutation((records) => {
    if (
      records.some((record) => {
        const element =
          record.target.nodeType === 1
            ? (record.target as Element)
            : record.target.parentElement;
        return !element?.closest(".state-trace");
      })
    )
      align();
  });
  for (const element of new Set([
    reference.closest(".mes") ?? reference,
    block.closest(".mes") ?? block,
  ]))
    typographyObserver.observe(element, {
      attributes: true,
      attributeFilter: ["style", "class"],
      childList: true,
      subtree: true,
    });
  for (const element of [
    page.documentElement,
    page.body,
    page.querySelector("#chat"),
  ])
    if (element)
      typographyObserver.observe(element, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
  view.addEventListener("resize", align);
  align();
  return () => {
    observer.disconnect();
    typographyObserver.disconnect();
    view.removeEventListener("resize", align);
  };
}
