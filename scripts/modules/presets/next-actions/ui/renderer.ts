import type {
  ModuleContext,
  ModuleSettings,
} from "../../../../../shared/contracts/module.ts";
import { parseNextActions } from "../domain/parser.ts";
import { createPanel, setAvailability } from "./panel.ts";
import { NextActionExecutor } from "../actions/execute.ts";
import css from "./styles.css?raw";

interface RenderedMessage {
  id: number;
  raw: string;
  original: DocumentFragment;
  marker: Comment;
  panel?: HTMLElement;
  unmount: () => void;
}

export class NextActionsRenderer {
  private readonly records = new Map<HTMLElement, RenderedMessage>();
  private readonly page: Document;
  private readonly style: HTMLStyleElement;
  private readonly executor: NextActionExecutor;
  private readonly scope: string;
  private readonly background: Promise<string | undefined>;
  private readonly markerImage: Promise<string | undefined>;

  constructor(
    private readonly context: ModuleContext,
    settings: ModuleSettings,
    private readonly isOwner: () => boolean,
  ) {
    this.executor = new NextActionExecutor(context, settings, () =>
      this.updateAvailability(),
    );
    this.background = context.theme
      .image("next-actions.panel")
      .catch(() => undefined);
    this.markerImage = context.theme
      .image("next-actions.list-marker")
      .catch(() => undefined);
    this.page = context.host.document;
    this.scope = JSON.stringify(context.scope);
    this.style = this.page.createElement("style");
    this.style.dataset.loreloomNextActions = context.instanceId;
    this.style.textContent = css;
    this.page.head.append(this.style);
    context.lifecycle.defer(() => {
      this.clear();
      this.style.remove();
    });
  }
  private isCurrent(): boolean {
    if (this.context.signal.aborted || !this.isOwner()) return false;
    try {
      return JSON.stringify(this.context.host.scope()) === this.scope;
    } catch {
      return false;
    }
  }
  private format(text: string, id: number): DocumentFragment {
    const template = this.page.createElement("template");
    template.innerHTML = this.context.host.formatMessage(text, id);
    return template.content;
  }
  private release(
    element: HTMLElement,
    record: RenderedMessage,
    restore: boolean,
  ): void {
    if (restore && element.contains(record.marker)) {
      let original = record.original;
      try {
        if (JSON.stringify(this.context.host.scope()) === this.scope) {
          const id = Number(
            element.closest(".mes[mesid]")?.getAttribute("mesid"),
          );
          const latest = Number.isSafeInteger(id)
            ? this.context.host.messages()[id]
            : undefined;
          if (typeof latest?.mes === "string" && latest.mes !== record.raw)
            original = this.format(latest.mes, id);
        }
      } catch {
        /* Retain the captured DOM if the old host context is unavailable. */
      }
      element.replaceChildren(original);
    }
    record.unmount();
    this.records.delete(element);
  }
  clear(): void {
    for (const [element, record] of this.records)
      this.release(element, record, true);
    this.executor.reset();
  }
  generating(value: boolean): void {
    if (!value) this.executor.reset();
    this.updateAvailability();
  }
  private busy(): boolean {
    return this.context.host.isGenerating();
  }
  renderAll(): void {
    if (!this.isCurrent()) {
      this.clear();
      return;
    }
    for (const [element, record] of this.records) {
      if (!element.isConnected || !element.contains(record.marker))
        this.release(element, record, false);
    }
    if (this.busy()) {
      this.updateAvailability();
      return;
    }
    const messages = this.context.host.messages();
    for (const element of this.page.querySelectorAll<HTMLElement>(
      "#chat .mes[mesid] .mes_text",
    )) {
      const attribute = element.closest(".mes[mesid]")?.getAttribute("mesid");
      if (!attribute || !/^\d+$/.test(attribute)) continue;
      const id = Number(attribute);
      if (!Number.isSafeInteger(id)) continue;
      const message = messages[id];
      const previous = this.records.get(element);
      if (
        !message ||
        message.is_user ||
        message.is_system ||
        typeof message.mes !== "string"
      ) {
        if (previous) this.release(element, previous, true);
        continue;
      }
      // Wait for the host to replace swipe placeholders before formatting again.
      if (element.textContent?.trim() === "...") continue;
      if (
        previous?.id === id &&
        previous.raw === message.mes &&
        element.contains(previous.marker)
      )
        continue;
      const parsed = parseNextActions(message.mes);
      if (!parsed.hasBlock) {
        if (previous && element.contains(previous.marker)) {
          const replacement = this.format(message.mes, id);
          this.release(element, previous, false);
          element.replaceChildren(replacement);
        }
        continue;
      }
      const fragment = this.page.createDocumentFragment();
      if (parsed.beforeText)
        fragment.append(this.format(parsed.beforeText, id));
      let panel: HTMLElement | undefined;
      let unmount = () => {};
      if (parsed.actions.length) {
        const created = createPanel(
          this.context,
          parsed.actions,
          { background: this.background, marker: this.markerImage },
          () => this.isCurrent(),
          (event) => this.click(event),
        );
        panel = created.panel;
        unmount = created.unmount;
        fragment.append(panel);
      }
      try {
        if (parsed.afterText)
          fragment.append(this.format(parsed.afterText, id));
        const foreignPanel = element.querySelector(".loreloom-next-actions");
        const original =
          previous || foreignPanel
            ? this.format(message.mes, id)
            : this.page.createDocumentFragment();
        if (!previous && !foreignPanel)
          while (element.firstChild) original.append(element.firstChild);
        if (previous) this.release(element, previous, false);
        const marker = this.page.createComment("loreloom-next-actions");
        fragment.append(marker);
        element.replaceChildren(fragment);
        this.records.set(element, {
          id,
          raw: message.mes,
          original,
          marker,
          panel,
          unmount,
        });
      } catch (error) {
        unmount();
        throw error;
      }
    }
    this.updateAvailability();
  }
  updateAvailability(): void {
    const available = this.isCurrent() && !this.busy();
    const latest = this.context.host.messages().length - 1;
    for (const record of this.records.values()) {
      const enabled =
        available &&
        record.id === latest &&
        !this.executor.blocked(`${record.id}:${record.raw}`);
      for (const row of record.panel?.querySelectorAll<HTMLElement>(
        "[data-action-index]",
      ) ?? [])
        setAvailability(row, enabled);
    }
  }
  private click(event: Event): void {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== "function") return;
    const button = target.closest<HTMLElement>("[data-action-index]");
    const panel = button?.closest<HTMLElement>(".loreloom-next-actions");
    if (
      !button ||
      !panel ||
      panel.dataset.owner !== this.context.instanceId ||
      !this.isCurrent() ||
      this.busy()
    )
      return;
    const element = panel.closest<HTMLElement>(".mes_text");
    const record = element ? this.records.get(element) : undefined;
    const messages = this.context.host.messages();
    if (
      !record ||
      !element?.contains(record.marker) ||
      record.id !== messages.length - 1 ||
      messages[record.id]?.mes !== record.raw ||
      button.dataset.available !== "true"
    )
      return;
    const selection = this.context.host.window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const action = parseNextActions(record.raw).actions[
      Number(button.dataset.actionIndex)
    ];
    if (action) this.executor.execute(action, `${record.id}:${record.raw}`);
  }
}
