import type { ModuleContext } from "../../../../../shared/contracts/module.ts";

let sequence = 0;
export function createDetails(context: ModuleContext, container: HTMLElement) {
  const page = context.host.document;
  const tip = page.createElement("div");
  tip.className = "state-trace__tooltip";
  tip.id = `state-trace-details-${context.instanceId}-${++sequence}`;
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  const popover = typeof tip.showPopover === "function";
  if (popover) tip.setAttribute("popover", "auto");
  const heading = page.createElement("strong");
  const content = page.createElement("div");
  tip.append(heading, content);
  container.append(tip);
  let active: HTMLElement | undefined;
  let pinned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function cancelHide(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  function hide(): void {
    cancelHide();
    if (popover && tip.matches(":popover-open")) tip.hidePopover();
    tip.hidden = true;
    active = undefined;
    pinned = false;
    page.removeEventListener("pointerdown", outside, true);
    page.removeEventListener("keydown", escape, true);
    page.removeEventListener("scroll", scroll, true);
    context.host.window.removeEventListener("resize", hide);
  }
  function outside(event: Event): void {
    const target = event.target as Node | null;
    if (target && tip.contains(target)) {
      pinned = true;
      return;
    }
    if (target && active?.contains(target)) return;
    hide();
  }
  function escape(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    hide();
  }
  function scroll(event: Event): void {
    const target = event.target as Node | null;
    if (pinned || (target?.nodeType && tip.contains(target))) return;
    hide();
  }
  function show(
    anchor: HTMLElement,
    label: string,
    full: string,
    pin = false,
  ): void {
    if (!anchor.isConnected) return;
    cancelHide();
    pinned = active === anchor ? pinned || pin : pin;
    active = anchor;
    heading.textContent = label;
    content.textContent = full;
    tip.hidden = false;
    if (popover && !tip.matches(":popover-open")) tip.showPopover();
    const bounds = anchor.getBoundingClientRect();
    const viewport = page.documentElement;
    tip.style.left = `${Math.max(8, Math.min(bounds.left, viewport.clientWidth - tip.offsetWidth - 8))}px`;
    const top = bounds.top - tip.offsetHeight - 8;
    tip.style.top = `${Math.max(8, top >= 8 ? top : Math.min(bounds.bottom + 8, viewport.clientHeight - tip.offsetHeight - 8))}px`;
    page.addEventListener("pointerdown", outside, true);
    page.addEventListener("keydown", escape, true);
    page.addEventListener("scroll", scroll, true);
    context.host.window.addEventListener("resize", hide);
  }
  function leave(anchor: HTMLElement): void {
    if (pinned || page.activeElement === anchor) return;
    cancelHide();
    timer = setTimeout(hide, 140);
  }
  tip.addEventListener("pointerenter", cancelHide);
  tip.addEventListener("pointerleave", () => {
    if (active) leave(active);
  });
  tip.addEventListener("toggle", () => {
    if (popover && !tip.matches(":popover-open") && active) hide();
  });
  function bind(
    anchor: HTMLElement,
    label: string,
    full: string,
    abbreviated = false,
  ): void {
    const eligible = () =>
      abbreviated ||
      full.includes("\n") ||
      anchor.scrollWidth > anchor.clientWidth + 1;
    anchor.tabIndex = 0;
    anchor.setAttribute("role", "button");
    anchor.setAttribute("aria-label", `${label}: ${full}`);
    anchor.setAttribute("aria-describedby", tip.id);
    anchor.classList.add("state-trace__detail-trigger");
    let touch = false;
    anchor.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch" && eligible())
        show(anchor, label, full);
    });
    anchor.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse") leave(anchor);
    });
    anchor.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      touch = true;
    });
    anchor.addEventListener("pointercancel", () => {
      touch = false;
    });
    anchor.addEventListener("focus", () => {
      if (!touch) show(anchor, label, full);
    });
    anchor.addEventListener("blur", () => {
      if (active === anchor && !pinned) hide();
    });
    anchor.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      show(anchor, label, full, true);
      touch = false;
    });
    anchor.addEventListener("contextmenu", (event) => {
      if (!eligible()) return;
      event.preventDefault();
      if (!touch) show(anchor, label, full, true);
    });
    anchor.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        show(anchor, label, full, true);
      }
    });
  }
  return {
    bind,
    dispose: () => {
      hide();
      tip.remove();
    },
  };
}
export type StateDetails = ReturnType<typeof createDetails>;
