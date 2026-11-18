export function alignToolCalls(page: Document, owner: string): void {
  const reference =
    page.querySelector<HTMLElement>(
      `#chat .mes:not(.smallSysMes) .mes_text.loreloom-text-style--assistant[data-loreloom-text-owner="${owner}"]`,
    ) ??
    page.querySelector<HTMLElement>(
      `#chat .mes:not(.smallSysMes) .mes_text.loreloom-text-style[data-loreloom-text-owner="${owner}"]`,
    );
  const body = reference?.getBoundingClientRect();
  for (const message of page.querySelectorAll<HTMLElement>(
    `#chat .mes.toolCall.loreloom-text-style-tools[data-loreloom-text-extras="${owner}"]`,
  )) {
    const block = message.querySelector<HTMLElement>(".mes_block");
    if (!block) continue;
    if (!body?.width) {
      message.style.removeProperty("--text-style-body-width");
      message.style.removeProperty("--text-style-body-offset");
      continue;
    }
    const padding =
      parseFloat(page.defaultView!.getComputedStyle(block).paddingLeft) || 0;
    const offset = Math.max(
      0,
      body.left - block.getBoundingClientRect().left - padding,
    );
    for (const [key, value] of [
      ["--text-style-body-width", `${body.width}px`],
      ["--text-style-body-offset", `${offset}px`],
    ])
      if (message.style.getPropertyValue(key!) !== value)
        message.style.setProperty(key!, value!);
  }
}
