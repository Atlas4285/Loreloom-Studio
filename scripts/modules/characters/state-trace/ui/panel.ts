import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import {
  accepts,
  type Config,
  type Field,
  type Value,
  type Values,
} from "../domain/config.ts";
import type { StateHost } from "../runtime/host.ts";
import { pendingSwipe, type Session, type StateStore } from "../state/store.ts";
import { errorText } from "../domain/errors.ts";
import { message } from "../../../../../shared/i18n/message.ts";
import { formatStateNumber } from "./format.ts";
import { createDetails, type StateDetails } from "./details.ts";
import { alignPanel } from "./layout.ts";
export function createPanel(
  context: ModuleContext,
  host: StateHost,
  store: StateStore,
  generating: () => boolean,
  isActive: () => boolean,
  onStateChanged: () => void,
) {
  const page = context.host.document;
  let cardNode: HTMLElement | undefined;
  let unmount: (() => void) | undefined;
  let signature = "";
  let details: StateDetails | undefined;
  let removeLayout: (() => void) | undefined;
  const panelBackground = context.theme
    .image("state-trace.panel")
    .catch(() => undefined);
  let editing = false;
  let baseline:
    { values: Values; session: Session; config: string } | undefined;
  let pending = false;
  function finishEditing(): void {
    editing = false;
    baseline = undefined;
  }
  function clearPanel(): void {
    removeLayout?.();
    removeLayout = undefined;
    details?.dispose();
    details = undefined;
    cardNode?.remove();
    cardNode = undefined;
    unmount?.();
    unmount = undefined;
    signature = "";
  }
  function displayText(field: Field, value: Value): string {
    return field.type === "toggle"
      ? context.translate(
          value === true
            ? message("loreloom.stateTrace.on", "On")
            : message("loreloom.stateTrace.off", "Off"),
        )
      : String(value);
  }
  function renderValue(
    field: Field,
    value: Value,
    onChange: (value: Value) => void,
  ): HTMLElement {
    const node = page.createElement("div");
    node.className = "state-trace__value";
    if (field.type === "progress") {
      const track = page.createElement("div");
      track.className = "state-trace__track";
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-label", field.label || field.name);
      track.setAttribute("aria-valuenow", String(value));
      track.setAttribute("aria-valuemin", String(field.min));
      track.setAttribute("aria-valuemax", String(field.max));
      const fill = page.createElement("span");
      fill.style.width = `${Math.max(0, Math.min(100, ((Number(value) - field.min!) / (field.max! - field.min!)) * 100))}%`;
      track.append(fill);
      node.append(track);
    }
    if (editing && field.type === "tag") {
      const wrapper = page.createElement("span");
      wrapper.className = "state-trace__select";
      const select = page.createElement("select");
      select.setAttribute("aria-label", field.label || field.name);
      for (const option of field.options ?? []) {
        const item = page.createElement("option");
        item.value = option;
        item.textContent = option;
        select.append(item);
      }
      select.value = String(value);
      select.addEventListener("change", () => onChange(select.value));
      wrapper.append(select);
      node.append(wrapper);
    } else if (editing && field.type === "toggle") {
      const toggle = page.createElement("button");
      toggle.type = "button";
      toggle.className = "state-trace__switch";
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-label", field.label || field.name);
      let checked = value === true;
      const update = (): void => {
        toggle.textContent = displayText(field, checked);
        toggle.setAttribute("aria-checked", String(checked));
        toggle.setAttribute("aria-pressed", String(checked));
      };
      toggle.addEventListener("click", () => {
        checked = !checked;
        update();
        onChange(checked);
      });
      update();
      node.append(toggle);
    } else if (editing) {
      const input = page.createElement(
        field.type === "text" ? "textarea" : "input",
      );
      if (field.type !== "text") {
        const numeric = input as HTMLInputElement;
        numeric.type = "number";
        numeric.step = "any";
        numeric.required = true;
        if (field.min !== undefined) numeric.min = String(field.min);
        if (field.max !== undefined) numeric.max = String(field.max);
      }
      input.setAttribute("aria-label", field.label || field.name);
      input.value = String(value);
      if (field.type === "text") (input as HTMLTextAreaElement).rows = 1;
      if (field.type === "text" && field.maxLength !== undefined)
        (input as HTMLTextAreaElement).maxLength = field.maxLength;
      const error = page.createElement("span");
      error.className = "state-trace__input-error";
      error.setAttribute("role", "alert");
      const validate = (): Value | undefined => {
        const next =
          field.type === "text"
            ? input.value
            : (input as HTMLInputElement).valueAsNumber;
        const valid = accepts(field, next) && input.checkValidity();
        input.setAttribute("aria-invalid", String(!valid));
        error.textContent = valid
          ? ""
          : context.translate(
              message(
                "loreloom.stateTrace.invalidInput",
                "Enter a valid value for {field}.",
              ),
              { field: field.label || field.name },
            );
        return valid ? next : undefined;
      };
      input.addEventListener("input", validate);
      input.addEventListener("change", () => {
        const next = validate();
        if (next !== undefined) onChange(next);
      });
      const numeric = page.createElement("div");
      numeric.className = "state-trace__numeric";
      numeric.append(input);
      if (field.type !== "text" && field.max !== undefined) {
        const maximum = page.createElement("span");
        maximum.textContent = `/${formatStateNumber(field.max)}`;
        details?.bind(
          maximum,
          field.label || field.name,
          String(field.max),
          true,
        );
        numeric.append(maximum);
      }
      node.append(numeric, error);
    } else {
      const text = page.createElement("span");
      const full =
        (field.type === "number" || field.type === "progress") &&
        field.max !== undefined
          ? `${value}/${field.max}`
          : displayText(field, value);
      text.textContent =
        field.type === "number" || field.type === "progress"
          ? `${formatStateNumber(Number(value))}${field.max === undefined ? "" : `/${formatStateNumber(field.max)}`}`
          : full;
      text.className =
        field.type === "tag"
          ? "state-trace__tag"
          : field.type === "text"
            ? "state-trace__text"
            : "state-trace__fraction";
      details?.bind(
        text,
        field.label || field.name,
        full,
        text.textContent !== full ||
          field.type === "tag" ||
          field.type === "toggle",
      );
      node.append(text);
    }
    if (field.type === "progress")
      node.classList.add("state-trace__value--progress");
    return node;
  }
  function renderPanel(config: Config): void {
    const current = host.current();
    if (
      !isActive() ||
      !host.isCurrent() ||
      !config.enabled ||
      !current.chatId
    ) {
      finishEditing();
      clearPanel();
      return;
    }
    const id = current.chat.length - 1;
    const chatMessage = current.chat[id];
    if (!chatMessage) {
      finishEditing();
      clearPanel();
      return;
    }
    const readOnly = generating() || pendingSwipe(chatMessage);
    if (
      readOnly ||
      (baseline &&
        (!store.sameSession(baseline.session) ||
          baseline.session.index !== id ||
          baseline.session.message !== chatMessage ||
          baseline.session.swipe !== (chatMessage.swipe_id ?? 0) ||
          baseline.config !== JSON.stringify(config)))
    )
      finishEditing();
    const block = page.querySelector(`#chat .mes[mesid="${id}"] .mes_block`);
    if (!block) {
      clearPanel();
      return;
    }
    const values = store.readState(config, id + 1);
    const nextSignature = JSON.stringify([
      config,
      values,
      editing,
      readOnly,
      id,
      chatMessage.swipe_id,
      current.chat.length,
      store.revision(),
      store.saveFailed(),
    ]);
    if (signature === nextSignature && cardNode?.parentElement === block)
      return;
    const previousFocus = page.activeElement as HTMLElement | null;
    const focusRow = previousFocus?.closest<HTMLElement>("[data-state-field]");
    const focusIndex = focusRow
      ? Array.from(
          focusRow.querySelectorAll(
            "input, textarea, select, button, [role=button]",
          ),
        ).indexOf(previousFocus!)
      : -1;
    const focusName = focusRow?.dataset.stateField;
    clearPanel();
    signature = nextSignature;
    const card = page.createElement("section");
    card.className = "state-trace";
    card.dataset.editing = String(editing);
    details = createDetails(context, card);
    card.setAttribute(
      "aria-label",
      context.translate(message("loreloom.stateTrace.title", "State trace")),
    );
    const background = page.createElement("img");
    background.className = "state-trace__background";
    background.hidden = true;
    void panelBackground.then((url) => {
      if (url && card.isConnected && !context.signal.aborted) {
        background.src = url;
        background.hidden = false;
      }
    });
    background.alt = "";
    background.draggable = false;
    background.setAttribute("aria-hidden", "true");
    card.append(background);
    const header = page.createElement("header");
    const heading = page.createElement("strong");
    heading.className = "state-trace__title";
    heading.textContent = context.translate(
      message("loreloom.stateTrace.title", "State trace"),
    );
    const edit = page.createElement("button");
    edit.type = "button";
    edit.disabled = readOnly;
    edit.className = "state-trace__edit";
    edit.setAttribute(
      "aria-label",
      editing
        ? context.translate(
            message("loreloom.stateTrace.finishEditing", "Finish editing"),
          )
        : context.translate(
            message("loreloom.stateTrace.editState", "Edit state"),
          ),
    );
    edit.setAttribute(
      "title",
      editing
        ? context.translate(
            message("loreloom.stateTrace.finishEditing", "Finish editing"),
          )
        : context.translate(
            message("loreloom.stateTrace.editState", "Edit state"),
          ),
    );
    edit.setAttribute("aria-pressed", String(editing));
    const icon = page.createElement("i");
    icon.className = editing ? "fa-solid fa-check" : "fa-solid fa-pen";
    icon.setAttribute("aria-hidden", "true");
    edit.append(icon);
    edit.addEventListener("click", () => {
      if (editing) finishEditing();
      else {
        baseline = {
          values: structuredClone(store.readState(config)),
          session: store.session(),
          config: JSON.stringify(config),
        };
        editing = true;
      }
      signature = "";
      renderPanel(config);
    });
    const reset = editing ? page.createElement("button") : undefined;
    if (reset) {
      reset.type = "button";
      reset.className = "state-trace__reset";
      reset.disabled = pending || !config.fields.length;
      const label = context.translate(
        message("loreloom.stateTrace.resetState", "Reset changes"),
      );
      reset.setAttribute("aria-label", label);
      reset.title = label;
      const icon = page.createElement("i");
      icon.className = "fa-solid fa-rotate-left";
      icon.setAttribute("aria-hidden", "true");
      reset.append(icon);
      reset.addEventListener("pointerdown", (event) => {
        // Keep an unfinished input focused until reset has been confirmed.
        if (event.button === 0) event.preventDefault();
      });
      reset.addEventListener("click", () => {
        if (pending || !baseline) return;
        if (
          !context.host.window.confirm(
            context.translate(
              message(
                "loreloom.stateTrace.confirmResetState",
                "Discard all state changes made since entering edit mode?",
              ),
            ),
          )
        )
          return;
        signature = "";
        saveState(structuredClone(baseline.values));
      });
    }
    header.append(heading);
    if (reset) header.append(reset);
    header.append(edit);
    card.append(header);
    const error = page.createElement("p");
    error.className = "state-trace__error";
    error.setAttribute("role", "alert");
    if (store.saveFailed())
      error.textContent = context.translate(
        message(
          "loreloom.stateTrace.errors.saveFailed",
          "Could not save state to the chat. The displayed changes may not have been persisted.",
        ),
      );
    const session = store.session();
    const revision = store.revision();
    function saveState(updates: Values): void {
      if (pending) return;
      pending = true;
      card.setAttribute("aria-busy", "true");
      edit.disabled = true;
      if (reset) reset.disabled = true;
      const sourceChat = current.chat;
      void store
        .editState(config, updates, session, revision)
        .then(() => {
          if (host.current().chat === sourceChat) onStateChanged();
        })
        .catch((failure) => {
          error.textContent = errorText(context, failure);
        })
        .finally(() => {
          pending = false;
          card.setAttribute("aria-busy", "false");
          edit.disabled = readOnly;
          if (reset) reset.disabled = !config.fields.length;
        });
    }
    const fields = page.createElement("div");
    fields.className = "state-trace__fields";
    for (const field of config.fields) {
      const row = page.createElement("div");
      row.className = "state-trace__field";
      row.dataset.stateField = field.name;
      row.dataset.stateType = field.type;
      row.dataset.stateSpan =
        field.type === "text" || field.type === "progress" ? "2" : "1";
      const label = page.createElement("span");
      label.textContent = field.label || field.name;
      label.className = "state-trace__label";
      details.bind(
        label,
        field.label || field.name,
        displayText(field, values[field.name]),
        field.type === "tag" || field.type === "toggle",
      );
      label.tabIndex = -1;
      row.append(
        label,
        renderValue(field, values[field.name], (value) => {
          saveState({ [field.name]: value });
        }),
      );
      fields.append(row);
    }
    card.append(fields);
    if (!config.fields.length) {
      const empty = page.createElement("p");
      empty.className = "state-trace__empty";
      empty.textContent = context.translate(
        message(
          "loreloom.stateTrace.emptyPanel",
          "Add state fields in settings.",
        ),
      );
      card.append(empty);
    }
    card.append(error);
    cardNode = card;
    unmount = context.theme.mount(card);
    block.append(card);
    removeLayout = alignPanel(context, card, block);
    if (focusName && focusIndex >= 0) {
      const row = Array.from(
        card.querySelectorAll<HTMLElement>("[data-state-field]"),
      ).find((row) => row.dataset.stateField === focusName);
      row
        ?.querySelectorAll<HTMLElement>(
          "input, textarea, select, button, [role=button]",
        )
        [focusIndex]?.focus({ preventScroll: true });
    }
  }

  context.lifecycle.defer(clearPanel);
  return {
    render: renderPanel,
    clear: () => {
      finishEditing();
      clearPanel();
    },
  };
}
export type StatePanel = ReturnType<typeof createPanel>;
