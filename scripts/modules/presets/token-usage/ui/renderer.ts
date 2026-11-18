import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { UsageHost } from "../runtime/host.ts";
import type { UsageTracker } from "../usage/tracker.ts";
import type { UsageHistory } from "../usage/history.ts";
import {
  contextLimit,
  hasRequestUsage,
  isUsageReference,
  isToolMessage,
  readRequests,
  messageUsageExtra,
  readStoredUsage,
  type TokenUsage,
} from "../domain/usage.ts";
import { createPanel } from "./panel.ts";
import css from "./styles.css?raw";
interface MountedCard {
  card: HTMLElement;
  signature: string;
  unmount: () => void;
}
export class UsageRenderer {
  private readonly cards = new Map<HTMLElement, MountedCard>();
  private readonly style: HTMLStyleElement;
  private summary?: MountedCard;
  constructor(
    private readonly context: ModuleContext,
    private readonly host: UsageHost,
    private readonly tracker: UsageTracker,
    private readonly history: UsageHistory,
    private readonly isActive: () => boolean,
    private readonly showSummary: () => boolean = () => true,
  ) {
    this.style = context.host.document.createElement("style");
    this.style.textContent = css;
    context.host.document.head.append(this.style);
    context.lifecycle.defer(() => {
      this.clear();
      this.style.remove();
    });
  }
  clear(): void {
    for (const state of this.cards.values()) {
      state.unmount();
      state.card.remove();
    }
    this.cards.clear();
    this.clearSummary();
  }
  private clearSummary(): void {
    this.summary?.unmount();
    this.summary?.card.remove();
    this.summary = undefined;
  }
  private usageFor(id: number, limit: number | undefined): TokenUsage[] {
    const message = this.host.current().chat[id];
    if (
      !message ||
      message.is_user ||
      (message.is_system && !isToolMessage(message))
    )
      return [];
    const extra = messageUsageExtra(message);
    if (hasRequestUsage(extra))
      return readRequests(extra, limit).filter(
        (item) => item.status !== "pending",
      );
    if (
      isUsageReference(extra) ||
      message.is_system ||
      this.tracker.isGenerating(id)
    )
      return [];
    const usage =
      (this.tracker.ignoresStored(id)
        ? undefined
        : readStoredUsage(extra, limit)) ?? this.history.get(id);
    return usage ? [usage] : [];
  }
  private renderSummary(limit: number | undefined): void {
    if (!this.showSummary()) {
      this.clearSummary();
      return;
    }
    const current = this.host.current();
    let id = current.chat.length - 1;
    let usage: TokenUsage | undefined;
    for (; id >= 0; id--) {
      usage = this.usageFor(id, limit).at(-1);
      if (usage && usage.total_tokens !== undefined && (limit ?? usage.limit))
        break;
    }
    const effectiveLimit = limit ?? usage?.limit;
    const entry = this.context.host.document.querySelector<HTMLElement>(
      "#qr--bar [data-loreloom-settings-entry]",
    );
    if (!entry || id < 0 || !current.chatId || !usage || !effectiveLimit) {
      this.clearSummary();
      return;
    }
    const signature = JSON.stringify([
      current.chatId,
      id,
      current.chat[id]?.swipe_id,
      { ...usage, limit: effectiveLimit },
    ]);
    if (this.summary?.signature !== signature) {
      this.clearSummary();
      const card = createPanel(
        this.context,
        { ...usage, limit: effectiveLimit },
        "summary",
      );
      this.summary = {
        card,
        signature,
        unmount: this.context.theme.mount(card),
      };
    }
    const bar = entry.closest<HTMLElement>("#qr--bar")!;
    let anchor = entry;
    while (anchor.parentElement && anchor.parentElement !== bar)
      anchor = anchor.parentElement;
    const font = bar.querySelector<HTMLElement>(".loreloom-font-status");
    if (font?.parentElement === bar) anchor = font;
    if (anchor.nextElementSibling !== this.summary.card)
      anchor.insertAdjacentElement("afterend", this.summary.card);
  }
  private syncTypography(card: HTMLElement, source: HTMLElement): void {
    const style = this.context.host.window.getComputedStyle(source);
    for (const [key, value] of [
      ["--token-usage-body-font-family", style.fontFamily],
      ["--token-usage-body-font-size", style.fontSize],
      ["--token-usage-body-font-weight", style.fontWeight],
      [
        "--token-usage-compact-line-height",
        style.getPropertyValue("--text-style-compact-line-height").trim() ||
          "1.2",
      ],
    ] as const)
      if (card.style.getPropertyValue(key) !== value)
        card.style.setProperty(key, value);
  }
  renderAll(): void {
    if (!this.isActive() || !this.host.isCurrent()) {
      this.clear();
      return;
    }
    const current = this.host.current();
    const limit = contextLimit(current);
    this.renderSummary(limit);
    const visible = new Set<HTMLElement>();
    for (const element of this.context.host.document.querySelectorAll<HTMLElement>(
      "#chat .mes[mesid]",
    )) {
      const id = Number(element.getAttribute("mesid"));
      if (!Number.isSafeInteger(id) || id < 0) continue;
      const block = element.querySelector<HTMLElement>(".mes_text");
      if (!block) continue;
      visible.add(block);
      const message = current.chat[id];
      const typography = message?.is_system
        ? (this.context.host.document.querySelector<HTMLElement>(
            "#chat .mes:not(.toolCall):not(.smallSysMes) .mes_text.loreloom-text-style--assistant",
          ) ??
          this.context.host.document.querySelector<HTMLElement>(
            '#chat .mes:not(.toolCall):not(.smallSysMes):not([is_system="true"]) .mes_text',
          ) ??
          block)
        : block;
      const usage = this.usageFor(id, limit);
      const existing = this.cards.get(block);
      if (!usage.length) {
        if (existing) {
          existing.unmount();
          existing.card.remove();
          this.cards.delete(block);
        }
        continue;
      }
      const signature = JSON.stringify([id, message?.swipe_id, usage]);
      if (
        existing?.signature === signature &&
        existing.card.parentElement === block
      ) {
        this.syncTypography(existing.card, typography);
        if (block.lastElementChild !== existing.card)
          block.append(existing.card);
        continue;
      }
      if (existing) {
        existing.unmount();
        existing.card.remove();
      }
      const card = this.context.host.document.createElement("div");
      card.className = "loreloom-token-usage loreloom-token-usage--requests";
      for (const item of usage) card.append(createPanel(this.context, item));
      const unmount = this.context.theme.mount(card);
      for (const child of Array.from(card.children))
        child.setAttribute("data-loreloom-root", "");
      block.append(card);
      this.syncTypography(card, typography);
      this.cards.set(block, { card, signature, unmount });
    }
    for (const [block, state] of this.cards)
      if (!visible.has(block)) {
        state.unmount();
        state.card.remove();
        this.cards.delete(block);
      }
  }
}
