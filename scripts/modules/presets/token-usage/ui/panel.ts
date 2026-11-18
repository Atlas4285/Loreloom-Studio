import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { TokenUsage } from "../domain/usage.ts";
import { message } from "../../../../../shared/i18n/message.ts";
import { formatTokens } from "./format.ts";
let tooltipSequence = 0;
export function createPanel(
  context: ModuleContext,
  usage: TokenUsage,
  variant: "message" | "summary" = "message",
): HTMLElement {
  const page = context.host.document;
  const card = page.createElement("div");
  card.className =
    variant === "summary"
      ? "loreloom-token-usage loreloom-token-usage--summary"
      : "loreloom-token-usage loreloom-token-usage--inline";
  card.dataset.owner = context.instanceId;
  const total =
    usage.total_tokens ??
    (usage.input !== undefined && usage.output !== undefined
      ? usage.input + usage.output
      : undefined);
  card.dataset.overLimit = String(
    total !== undefined && usage.limit !== undefined && total > usage.limit,
  );
  card.setAttribute("role", "group");
  card.setAttribute(
    "aria-label",
    context.translate(
      variant === "summary"
        ? message("loreloom.tokenUsage.context", "Context usage")
        : message("loreloom.tokenUsage.round", "Token usage for this request"),
    ),
  );
  function sourceDescription(source: string | undefined): string {
    return context.translate(
      source === "missing"
        ? message(
            "loreloom.tokenUsage.unavailableSource",
            "Some token usage data is unavailable",
          )
        : source === "api"
          ? message("loreloom.tokenUsage.apiSource", "Exact value")
          : message("loreloom.tokenUsage.estimatedSource", "Estimated value"),
    );
  }
  function information(
    description: string,
    trigger?: HTMLElement,
  ): HTMLElement {
    const wrapper = page.createElement("span");
    wrapper.className = "loreloom-token-usage__help";
    const info = page.createElement("button");
    info.type = "button";
    info.className = "loreloom-token-usage__info";
    info.textContent = "!";
    info.setAttribute("aria-label", description);
    const tip = page.createElement("span");
    tip.id = `loreloom-usage-${context.instanceId}-${++tooltipSequence}`;
    tip.className = "loreloom-token-usage__tooltip";
    tip.setAttribute("role", "tooltip");
    tip.textContent = description;
    info.setAttribute("aria-describedby", tip.id);
    const popover = typeof tip.showPopover === "function";
    if (popover) tip.setAttribute("popover", "auto");
    let pinned = false,
      touch = false;
    const anchor = trigger ?? info;
    function hide(): void {
      pinned = false;
      if (popover && tip.matches(":popover-open")) tip.hidePopover();
      tip.removeAttribute("data-open");
    }
    function show(): void {
      if (!info.isConnected) return;
      if (popover && !tip.matches(":popover-open")) tip.showPopover();
      else if (!popover) tip.setAttribute("data-open", "");
      const bounds = (
        anchor.getClientRects().length ? anchor : info
      ).getBoundingClientRect();
      const viewport = page.documentElement;
      tip.style.left = `${Math.max(8, Math.min(bounds.left, viewport.clientWidth - tip.offsetWidth - 8))}px`;
      const top = bounds.top - tip.offsetHeight - 8;
      tip.style.top = `${Math.max(8, top >= 8 ? top : Math.min(bounds.bottom + 8, viewport.clientHeight - tip.offsetHeight - 8))}px`;
    }
    for (const button of new Set([info, anchor])) {
      button.addEventListener("pointerdown", (event) => {
        touch = event.pointerType !== "mouse";
      });
      button.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "mouse") show();
      });
      button.addEventListener("pointerleave", (event) => {
        if (
          event.pointerType === "mouse" &&
          !pinned &&
          page.activeElement !== button
        )
          hide();
      });
      button.addEventListener("focus", () => {
        if (!touch) show();
      });
      button.addEventListener("blur", () => {
        if (!pinned) hide();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        show();
        pinned = true;
        touch = false;
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === "Escape") hide();
      });
    }
    tip.addEventListener("toggle", () => {
      if (popover && !tip.matches(":popover-open")) pinned = false;
    });
    wrapper.append(info, tip);
    return wrapper;
  }
  function count(text: string, value: number | undefined): HTMLElement {
    const wrapper = page.createElement("span");
    wrapper.className = "loreloom-token-usage__count";
    const number = page.createElement("span");
    number.className = "loreloom-token-usage__number";
    number.textContent = value === undefined ? "—" : formatTokens(value);
    const label = page.createElement("span");
    label.className = "loreloom-token-usage__label";
    label.textContent = `${text}:`;
    wrapper.append(label, number);
    return wrapper;
  }
  if (variant === "message") {
    const counts = page.createElement("div");
    counts.className = "loreloom-token-usage__counts";
    const inputLabel = context.translate(
      message("loreloom.tokenUsage.input", "Input tokens"),
    );
    const outputLabel = context.translate(
      message("loreloom.tokenUsage.output", "Output tokens"),
    );
    const output = count(outputLabel, usage.output);
    output.append(
      information(
        sourceDescription(
          usage.input === undefined || usage.output === undefined
            ? "missing"
            : usage.inputSource === "api" && usage.outputSource === "api"
              ? "api"
              : "tokenizer",
        ),
      ),
    );
    counts.append(count(inputLabel, usage.input), output);
    card.append(counts);
    return card;
  }
  if (total === undefined || !usage.limit) return card;
  const totalRow = page.createElement("div");
  totalRow.className = "loreloom-token-usage__total";
  const track = page.createElement("div");
  track.className = "loreloom-token-usage__track";
  track.setAttribute("role", "progressbar");
  track.setAttribute(
    "aria-label",
    context.translate(message("loreloom.tokenUsage.context", "Context usage")),
  );
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", String(usage.limit));
  track.setAttribute("aria-valuenow", String(Math.min(total, usage.limit)));
  track.setAttribute(
    "aria-valuetext",
    context.translate(
      message("loreloom.tokenUsage.progress", "{used} of {limit} tokens"),
      {
        used: total.toLocaleString(context.locale),
        limit: usage.limit.toLocaleString(context.locale),
      },
    ),
  );
  const fill = page.createElement("span");
  fill.className = "loreloom-token-usage__fill";
  fill.style.setProperty(
    "--usage-percent",
    `${Math.min(100, (total / usage.limit) * 100)}%`,
  );
  fill.style.setProperty("--usage-min-width", total > 0 ? "3px" : "0px");
  track.append(fill);
  const fraction = page.createElement("span");
  fraction.className = "loreloom-token-usage__fraction";
  fraction.textContent = `${formatTokens(total)}/${formatTokens(usage.limit)}`;
  fraction.title = track.getAttribute("aria-valuetext") ?? "";
  const totalLabel = page.createElement("span");
  totalLabel.className = "loreloom-token-usage__label";
  totalLabel.textContent = context.translate(
    message("loreloom.tokenUsage.summaryTotal", "Total tokens"),
  );
  const mobile = page.createElement("button");
  mobile.type = "button";
  mobile.className = "loreloom-token-usage__summary-trigger";
  mobile.setAttribute("aria-label", totalLabel.textContent);
  const details = `${track.getAttribute("aria-valuetext")}\n${context.translate(message("loreloom.tokenUsage.input", "Input tokens"))}: ${usage.input?.toLocaleString(context.locale) ?? "—"}\n${context.translate(message("loreloom.tokenUsage.output", "Output tokens"))}: ${usage.output?.toLocaleString(context.locale) ?? "—"}\n${sourceDescription(usage.totalSource)}`;
  totalRow.append(
    totalLabel,
    track,
    fraction,
    information(details, mobile),
    mobile,
  );
  card.append(totalRow);
  return card;
}
