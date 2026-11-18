import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type {
  SettingsField,
  SettingsValues,
  SettingValue,
} from "../../../../../shared/contracts/settings.ts";
import { createSelect, type SelectView } from "./select.ts";
import { createResourceSelect } from "./resource-select.ts";
import type { ResourceStates } from "../../../../../shared/contracts/resources.ts";
export interface FieldsView {
  element: HTMLElement;
  sync(values: SettingsValues, resources?: ResourceStates): void;
  closeSelect(): boolean;
  dispose(): void;
}
export function createFields(
  context: ModuleContext,
  dialog: HTMLDialogElement,
  fields: SettingsField[],
  values: SettingsValues,
  change: (id: string, value: SettingValue) => void,
  action: (id: string, value: string) => void,
  resources: ResourceStates = {},
): FieldsView {
  const page = context.host.document;
  const element = page.createElement("div");
  const syncers: ((values: SettingsValues) => void)[] = [];
  const selects: SelectView[] = [];
  const resourceSyncers: ((
    values: SettingsValues,
    resources: ResourceStates,
  ) => void)[] = [];
  const prefix = `loreloom-settings-${context.instanceId}-`;
  // Feature scripts already localize their schema before publishing it.
  // The panel's bundled dictionary may belong to an older feature version.
  function fieldView(field: SettingsField): HTMLElement {
    if (field.type === "group") {
      const details = page.createElement("details");
      details.className = "loreloom-settings__group";
      details.open = field.expanded ?? true;
      const summary = page.createElement("summary");
      summary.className = "loreloom-settings__group-summary";
      summary.textContent = field.label.text;
      const children = page.createElement("div");
      children.className = "loreloom-settings__group-content";
      if (field.description) {
        const description = page.createElement("p");
        description.className = "loreloom-settings__description";
        description.textContent = field.description.text;
        children.append(description);
      }
      children.append(...field.fields.map(fieldView));
      details.append(summary, children);
      details.addEventListener("toggle", () => {
        if (!details.open) selects.forEach((select) => select.close());
      });
      return details;
    }
    const choice = field.type === "radio" || field.type === "multiselect";
    const wrapper = page.createElement(choice ? "fieldset" : "div");
    wrapper.className = "loreloom-settings__field";
    const label = page.createElement(choice ? "legend" : "label");
    label.className = `loreloom-settings__label loreloom-settings__label--${field.type === "boolean" ? "toggle" : field.type}`;
    const title = page.createElement("span");
    title.className = "loreloom-settings__label-text";
    title.textContent = field.label.text;
    label.append(title);
    wrapper.append(label);
    const id = prefix + field.id;
    label.setAttribute("for", id);
    const submit = (value: SettingValue) => change(field.id, value);
    const sync = (
      input: HTMLInputElement | HTMLTextAreaElement,
      apply: (value: SettingValue) => void,
    ) =>
      syncers.push((next) => {
        if (page.activeElement !== input) apply(next[field.id]!);
      });
    if (field.type === "resource") {
      const select = createResourceSelect(
        context,
        dialog,
        id,
        field.label.text,
        submit,
        (value) => action(field.id, value),
      );
      selects.push(select);
      wrapper.append(select.element);
      resourceSyncers.push((next, states) =>
        select.sync(
          String(next[field.id]),
          states[field.id] ?? { options: [] },
        ),
      );
    } else if (field.type === "select") {
      const select = createSelect(
        context,
        dialog,
        id,
        field.label.text,
        field.options,
        values[field.id] as string,
        submit,
      );
      selects.push(select);
      label.append(select.element);
      syncers.push((next) => {
        if (!select.element.contains(page.activeElement))
          select.set(next[field.id] as string);
      });
    } else if (field.type === "buttons" || choice) {
      const row = page.createElement("div");
      row.className =
        field.type === "buttons"
          ? "loreloom-settings__actions"
          : "loreloom-settings__choices";
      if (field.type === "buttons") {
        row.setAttribute("role", "group");
        row.setAttribute("aria-label", field.label.text);
        for (const option of field.options) {
          const button = page.createElement("button");
          button.type = "button";
          button.className = "loreloom-settings__action";
          button.textContent = option.label.text;
          button.addEventListener("click", () => {
            // Commit the focused editor before queuing an action. Otherwise
            // focused controls skip the returned values and retain stale drafts.
            // Explicit focus also covers browsers that do not focus on click.
            button.focus({ preventScroll: true });
            action(field.id, option.value);
          });
          row.append(button);
        }
      } else {
        const inputs: HTMLInputElement[] = [];
        for (const option of field.options) {
          const optionLabel = page.createElement("label");
          optionLabel.className = "loreloom-settings__choice";
          const input = page.createElement("input");
          input.className = "loreloom-settings__choice-input";
          input.type = field.type === "radio" ? "radio" : "checkbox";
          input.name = id;
          input.value = option.value;
          const text = page.createElement("span");
          text.textContent = option.label.text;
          optionLabel.append(input, text);
          row.append(optionLabel);
          inputs.push(input);
          input.addEventListener("change", () => {
            if (field.type === "radio") {
              if (input.checked) submit(input.value);
            } else
              submit(
                inputs.filter((item) => item.checked).map((item) => item.value),
              );
          });
        }
        syncers.push((next) =>
          inputs.forEach((input) => {
            input.checked =
              field.type === "radio"
                ? next[field.id] === input.value
                : (next[field.id] as string[]).includes(input.value);
          }),
        );
      }
      wrapper.append(row);
    } else if (field.type === "boolean") {
      const input = page.createElement("input");
      input.type = "checkbox";
      input.id = id;
      input.className = "loreloom-settings__toggle";
      input.checked = values[field.id] as boolean;
      input.addEventListener("change", () => submit(input.checked));
      label.append(input);
      syncers.push((next) => {
        input.checked = next[field.id] as boolean;
      });
    } else if (field.type === "text" || field.type === "textarea") {
      const input = page.createElement(
        field.type === "text" ? "input" : "textarea",
      );
      input.id = id;
      input.className = "loreloom-settings__input";
      if (field.type === "text") input.setAttribute("type", "text");
      input.value = values[field.id] as string;
      if (field.placeholder) input.placeholder = field.placeholder.text;
      if (field.maxLength !== undefined) input.maxLength = field.maxLength;
      if (field.type === "textarea" && field.rows !== undefined)
        input.setAttribute("rows", String(field.rows));
      input.addEventListener("change", () => submit(input.value));
      label.append(input);
      sync(input, (value) => {
        input.value = String(value);
      });
    } else if (field.type === "number" || field.type === "range") {
      const input = page.createElement("input");
      input.type = field.type;
      input.id = id;
      input.className = `loreloom-settings__${field.type}`;
      input.step = String(field.step ?? (field.integer ? 1 : "any"));
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      input.value = String(values[field.id]);
      const valid = (control: HTMLInputElement) =>
        !!control.value.trim() &&
        control.checkValidity() &&
        Number.isFinite(control.valueAsNumber);
      input.addEventListener("change", () => {
        if (valid(input)) submit(input.valueAsNumber);
      });
      if (field.type === "range") {
        const row = page.createElement("div");
        row.className = "loreloom-settings__range-row";
        const track = page.createElement("div");
        track.className = "loreloom-settings__range-control";
        track.append(input);
        const number = page.createElement("input");
        number.type = "number";
        number.className = "loreloom-settings__range-value";
        number.setAttribute("aria-label", field.label.text);
        number.inputMode = field.integer ? "numeric" : "decimal";
        number.step = input.step;
        number.min = input.min;
        number.max = input.max;
        let latest = input.value;
        const display = (value: string) => {
          input.value = value;
          number.value = value;
        };
        display(latest);
        input.addEventListener("input", () => {
          number.value = input.value;
        });
        number.addEventListener("input", () => {
          if (valid(number)) input.value = number.value;
        });
        number.addEventListener("change", () => {
          if (valid(number)) {
            input.value = number.value;
            submit(number.valueAsNumber);
          } else display(latest);
        });
        number.addEventListener("blur", () => {
          if (!valid(number)) display(latest);
        });
        number.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          number.blur();
        });
        syncers.push((next) => {
          latest = String(next[field.id]);
          if (page.activeElement !== input && page.activeElement !== number)
            display(latest);
        });
        row.append(track, number);
        wrapper.append(row);
      } else {
        label.append(input);
        sync(input, (value) => {
          input.value = String(value);
        });
      }
    }
    if (field.description) {
      const description = page.createElement("p");
      description.className = "loreloom-settings__description";
      description.textContent = field.description.text;
      wrapper.append(description);
    }
    return wrapper;
  }
  element.append(...fields.map(fieldView));
  syncers.forEach((sync) => sync(values));
  resourceSyncers.forEach((sync) => sync(values, resources));
  return {
    element,
    sync: (next, states = {}) => {
      syncers.forEach((sync) => sync(next));
      resourceSyncers.forEach((sync) => sync(next, states));
    },
    closeSelect: () => {
      let closed = false;
      selects.forEach((select) => {
        closed = select.close() || closed;
      });
      return closed;
    },
    dispose: () => selects.forEach((select) => select.dispose()),
  };
}
