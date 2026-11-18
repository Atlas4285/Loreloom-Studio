export function hasMessageContent(text: HTMLElement): boolean {
  const content = (text.textContent ?? "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .trim();
  if (content && content !== "...") return true;
  return !!text.querySelector(
    "img:not(.loreloom-text-style__background):not(.loreloom-text-style__background *), video, audio, iframe, canvas, svg, hr, table",
  );
}
