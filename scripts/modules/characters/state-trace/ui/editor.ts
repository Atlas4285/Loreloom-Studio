import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import {
  FIELD_TYPES,
  validateConfig,
  type Field,
  type FieldType,
} from "../domain/config.ts";
import { StateError, errorText } from "../domain/errors.ts";
import { message } from "../../../../../shared/i18n/message.ts";
import type { ConfigStore } from "../settings/config-store.ts";
export function createEditor(
  context: ModuleContext,
  store: ConfigStore,
  generating: () => boolean,
  isActive: () => boolean,
  onSaved: () => void,
) {
  let dialog: HTMLDialogElement | undefined;
  let requestClose: (() => Promise<boolean>) | undefined;
  let disposeEditor: (() => void) | undefined;
  const page = context.host.document;

  function action(label: string, handler: () => void): HTMLButtonElement {
    const button = page.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }
  function textField(
    parent: HTMLElement,
    label: string,
    value: string,
    onInput: (value: string) => void,
    multiline = false,
  ): HTMLInputElement | HTMLTextAreaElement {
    const wrapper = page.createElement("label");
    wrapper.textContent = label;
    const input = page.createElement(multiline ? "textarea" : "input");
    if (multiline) (input as HTMLTextAreaElement).rows = 2;
    input.value = value;
    input.addEventListener("input", () => onInput(input.value));
    wrapper.append(input);
    parent.append(wrapper);
    return input;
  }
  function numberField(
    parent: HTMLElement,
    label: string,
    value: number | undefined,
    onInput: (value: number | undefined) => void,
  ): HTMLInputElement {
    const wrapper = page.createElement("label");
    wrapper.textContent = label;
    const input = page.createElement("input");
    input.type = "number";
    input.step = "any";
    input.value = value === undefined ? "" : String(value);
    input.addEventListener("input", () =>
      onInput(
        input.validity.badInput
          ? NaN
          : input.value === ""
            ? undefined
            : input.valueAsNumber,
      ),
    );
    wrapper.append(input);
    parent.append(wrapper);
    return input;
  }
  function changeType(field: Field, type: FieldType): void {
    field.type = type;
    delete field.min;
    delete field.max;
    delete field.maxLength;
    delete field.options;
    field.defaultValue =
      type === "toggle" ? false : type === "text" || type === "tag" ? "" : 0;
    if (type === "progress" || type === "number") {
      field.min = 0;
      field.max = 100;
    }
    if (type === "tag") {
      const first = context.translate(
        message("loreloom.stateTrace.newTag", "Tag {index}"),
        { index: 1 },
      );
      field.options = [first];
      field.defaultValue = first;
    }
  }
  function open(): void {
    if (!isActive() || context.signal.aborted) return;
    if (dialog?.open) {
      dialog.focus();
      return;
    }
    close();
    if (dialog) return;
    const draft = structuredClone(store.getConfig());
    const originalFields = structuredClone(draft.fields);
    const expectedRevision = store.revision();
    let saved = false;
    let disposed = false;
    let saving: Promise<boolean> | undefined;
    const previousFocus = page.activeElement as HTMLElement | null;
    const modal = page.createElement("dialog");
    const unmount = context.theme.mount(modal);
    modal.className = "state-trace-editor";
    modal.setAttribute(
      "aria-labelledby",
      `state-trace-editor-${context.instanceId}`,
    );
    const header = page.createElement("header");
    const title = page.createElement("h2");
    title.textContent = context.translate(
      message(
        "loreloom.stateTrace.editorTitle",
        "State trace / Field configuration",
      ),
    );
    title.id = `state-trace-editor-${context.instanceId}`;
    const closeButton = action(
      context.translate(message("loreloom.stateTrace.close", "Close")),
      () => saveAndClose(),
    );
    closeButton.addEventListener("click", (event) => event.stopPropagation());
    header.append(title, closeButton);
    const body = page.createElement("div");
    body.className = "state-trace-editor__body";
    const fields = page.createElement("div");
    fields.className = "state-trace-editor__fields";
    body.append(fields);
    const renderFields = (): void => {
      const scrollTop = body.scrollTop;
      fields.replaceChildren();
      if (!draft.fields.length) {
        const empty = page.createElement("p");
        empty.textContent = context.translate(
          message(
            "loreloom.stateTrace.emptyEditor",
            "Add fields to define the state to track.",
          ),
        );
        fields.append(empty);
      }
      draft.fields.forEach((field, index) => {
        const card = page.createElement("section");
        card.className = "state-trace-editor__card";
        const toolbar = page.createElement("div");
        toolbar.className = "state-trace-editor__toolbar";
        const caption = page.createElement("strong");
        caption.textContent = field.label || field.name;
        const up = action(
          context.translate(message("loreloom.stateTrace.moveUp", "Move up")),
          () => {
            [draft.fields[index - 1], draft.fields[index]] = [
              field,
              draft.fields[index - 1],
            ];
            renderFields();
          },
        );
        const down = action(
          context.translate(
            message("loreloom.stateTrace.moveDown", "Move down"),
          ),
          () => {
            [draft.fields[index + 1], draft.fields[index]] = [
              field,
              draft.fields[index + 1],
            ];
            renderFields();
          },
        );
        up.disabled = index === 0;
        down.disabled = index === draft.fields.length - 1;
        toolbar.append(
          caption,
          up,
          down,
          action(
            context.translate(message("loreloom.stateTrace.delete", "Delete")),
            () => {
              draft.fields.splice(index, 1);
              renderFields();
            },
          ),
        );
        card.append(toolbar);
        const identity = page.createElement("div");
        identity.className = "state-trace-editor__row";
        card.append(identity);
        textField(
          identity,
          context.translate(
            message("loreloom.stateTrace.fieldName", "Field name"),
          ),
          field.name,
          (value) => {
            field.name = value;
            displayName.placeholder = value;
            caption.textContent = field.label || value;
          },
        );
        const displayName = textField(
          identity,
          context.translate(
            message("loreloom.stateTrace.displayName", "Display name"),
          ),
          field.label,
          (value) => {
            field.label = value;
            caption.textContent = value || field.name;
          },
        );
        displayName.placeholder = field.name;
        const typeLabel = page.createElement("label");
        const typeName = context.translate(
          message("loreloom.stateTrace.fieldType", "Type"),
        );
        typeLabel.textContent = typeName;
        const typeControl = page.createElement("span");
        typeControl.className = "state-trace-editor__select";
        const typeSelect = page.createElement("select");
        typeSelect.setAttribute("aria-label", typeName);
        for (const item of FIELD_TYPES) {
          const option = page.createElement("option");
          option.value = item.value;
          option.textContent = context.translate(item.label);
          typeSelect.append(option);
        }
        typeSelect.value = field.type;
        typeSelect.addEventListener("change", () => {
          changeType(field, typeSelect.value as FieldType);
          renderFields();
          fields
            .querySelectorAll("select")
            [index]?.focus({ preventScroll: true });
        });
        typeControl.append(typeSelect);
        typeLabel.append(typeControl);
        identity.append(typeLabel);
        textField(
          card,
          context.translate(
            message("loreloom.stateTrace.description", "Field description"),
          ),
          field.description,
          (value) => {
            field.description = value;
          },
          true,
        );
        const defaults = page.createElement("div");
        defaults.className = "state-trace-editor__row";
        if (field.type === "number" || field.type === "progress") {
          numberField(
            defaults,
            context.translate(
              message("loreloom.stateTrace.defaultValue", "Default value"),
            ),
            Number(field.defaultValue),
            (value) => {
              field.defaultValue = value ?? NaN;
            },
          );
          numberField(
            defaults,
            context.translate(
              message("loreloom.stateTrace.minimum", "Minimum"),
            ),
            field.min,
            (value) => {
              field.min = value;
            },
          );
          numberField(
            defaults,
            context.translate(
              message("loreloom.stateTrace.maximum", "Maximum"),
            ),
            field.max,
            (value) => {
              field.max = value;
            },
          );
        } else if (field.type === "text") {
          const defaultValue = textField(
            defaults,
            context.translate(
              message("loreloom.stateTrace.defaultValue", "Default value"),
            ),
            String(field.defaultValue),
            (value) => {
              field.defaultValue = value;
            },
            true,
          );
          (defaultValue as HTMLTextAreaElement).rows = 1;
          defaultValue.classList.add("state-trace-editor__text-default");
          defaultValue.parentElement!.classList.add("state-trace-editor__wide");
          const maximumLength = numberField(
            defaults,
            context.translate(
              message("loreloom.stateTrace.maximumLength", "Maximum length"),
            ),
            field.maxLength,
            (value) => {
              field.maxLength = value;
            },
          );
          maximumLength.placeholder = context.translate(
            message("loreloom.stateTrace.unlimited", "Unlimited"),
          );
          maximumLength.min = "1";
          maximumLength.step = "1";
        } else if (field.type === "toggle") {
          const defaultLabel = context.translate(
            message("loreloom.stateTrace.default", "Default"),
          );
          const label = page.createElement("label");
          label.textContent = defaultLabel;
          const toggle = action("", () => {
            field.defaultValue = !field.defaultValue;
            updateToggle();
          });
          const updateToggle = (): void => {
            toggle.textContent = field.defaultValue
              ? context.translate(message("loreloom.stateTrace.on", "On"))
              : context.translate(message("loreloom.stateTrace.off", "Off"));
            toggle.setAttribute("aria-checked", String(field.defaultValue));
            toggle.setAttribute("aria-pressed", String(field.defaultValue));
          };
          toggle.className = "state-trace-editor__switch";
          toggle.setAttribute("role", "switch");
          toggle.setAttribute("aria-label", defaultLabel);
          updateToggle();
          label.append(toggle);
          defaults.append(label);
        } else {
          const tags = page.createElement("section");
          tags.className = "state-trace-editor__tags";
          const label = page.createElement("strong");
          label.textContent = context.translate(
            message("loreloom.stateTrace.tagOptions", "Available tags"),
          );
          const list = page.createElement("div");
          list.className = "state-trace-editor__tag-list";
          const renderTags = (): void => {
            list.replaceChildren();
            const options = (field.options ??= []);
            options.forEach((option, optionIndex) => {
              const row = page.createElement("div");
              row.className = "state-trace-editor__tag-row";
              const input = page.createElement("input");
              input.value = option;
              input.setAttribute(
                "aria-label",
                context.translate(
                  message("loreloom.stateTrace.tagName", "Tag name"),
                ),
              );
              input.addEventListener("input", () => {
                if (field.defaultValue === options[optionIndex])
                  field.defaultValue = input.value;
                options[optionIndex] = input.value;
              });
              const select = action(
                context.translate(
                  message("loreloom.stateTrace.default", "Default"),
                ),
                () => {
                  field.defaultValue = options[optionIndex];
                  renderTags();
                },
              );
              select.setAttribute(
                "aria-pressed",
                String(option === field.defaultValue),
              );
              const remove = action(
                context.translate(
                  message("loreloom.stateTrace.delete", "Delete"),
                ),
                () => {
                  const removed = options.splice(optionIndex, 1)[0];
                  if (field.defaultValue === removed)
                    field.defaultValue = options[0] ?? "";
                  renderTags();
                },
              );
              row.append(input, select, remove);
              list.append(row);
            });
          };
          const add = action(
            context.translate(message("loreloom.stateTrace.addTag", "Add tag")),
            () => {
              const options = (field.options ??= []);
              let index = options.length + 1;
              while (
                options.includes(
                  context.translate(
                    message("loreloom.stateTrace.newTag", "Tag {index}"),
                    { index },
                  ),
                )
              )
                index++;
              options.push(
                context.translate(
                  message("loreloom.stateTrace.newTag", "Tag {index}"),
                  { index },
                ),
              );
              if (options.length === 1) field.defaultValue = options[0];
              renderTags();
            },
          );
          add.className = "state-trace-editor__add-tag";
          tags.append(label, list, add);
          renderTags();
          card.append(tags);
        }
        if (defaults.childElementCount) card.append(defaults);
        fields.append(card);
      });
      body.scrollTop = scrollTop;
    };
    const error = page.createElement("p");
    error.className = "state-trace-editor__error";
    error.setAttribute("role", "alert");
    const save = action(
      context.translate(message("loreloom.stateTrace.save", "Save")),
      () => saveAndClose(),
    );
    save.addEventListener("click", (event) => event.stopPropagation());
    const validateDraft = (): boolean => {
      if (saving) return false;
      try {
        validateConfig(draft);
        error.textContent = "";
        save.disabled = false;
        return true;
      } catch (failure) {
        error.textContent = errorText(context, failure);
        save.disabled = true;
        return false;
      }
    };
    modal.addEventListener("input", validateDraft);
    modal.addEventListener("change", validateDraft);
    let backdropPress = false;
    const onBackdrop = (event: MouseEvent) => {
      const rect = modal.getBoundingClientRect();
      return (
        event.target === modal &&
        (event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom)
      );
    };
    modal.addEventListener("pointerdown", (event) => {
      backdropPress = onBackdrop(event);
    });
    modal.addEventListener("pointercancel", () => {
      backdropPress = false;
    });
    modal.addEventListener("click", (event) => {
      const dismiss = backdropPress && onBackdrop(event);
      backdropPress = false;
      if (dismiss) {
        saveAndClose();
        return;
      }
      if (modal.open) validateDraft();
    });
    const reset = action(
      context.translate(message("loreloom.stateTrace.reset", "Reset")),
      () => {
        if (
          !context.host.window.confirm(
            context.translate(
              message(
                "loreloom.stateTrace.confirmResetChanges",
                "Reset all field changes made since opening this editor?",
              ),
            ),
          )
        )
          return;
        draft.fields = structuredClone(originalFields);
        renderFields();
        validateDraft();
      },
    );
    reset.title = context.translate(
      message(
        "loreloom.stateTrace.resetChanges",
        "Reset field changes made since opening this editor.",
      ),
    );
    const footer = page.createElement("footer");
    footer.append(
      action(
        context.translate(message("loreloom.stateTrace.addField", "Add field")),
        () => {
          let index = draft.fields.length + 1;
          while (draft.fields.some((field) => field.name === `field_${index}`))
            index++;
          draft.fields.push({
            name: `field_${index}`,
            label: "",
            description: "",
            type: "number",
            defaultValue: 0,
            min: 0,
            max: 100,
          });
          renderFields();
        },
      ),
      error,
      reset,
      save,
    );
    modal.append(header, body, footer);
    async function saveDraft(): Promise<boolean> {
      if (
        saved ||
        (store.isPersisted() &&
          JSON.stringify(draft.fields) === JSON.stringify(originalFields))
      )
        return true;
      try {
        if (!validateDraft()) return false;
        if (generating())
          throw new StateError(
            message(
              "loreloom.stateTrace.errors.waitGeneration",
              "Wait until this reply finishes before saving field configuration.",
            ),
          );
        if (!isActive()) throw new Error("State trace is no longer active.");
        const value = validateConfig(draft);
        const controls = Array.from(
          modal.querySelectorAll<
            | HTMLInputElement
            | HTMLTextAreaElement
            | HTMLSelectElement
            | HTMLButtonElement
          >("input, textarea, select, button"),
        );
        const disabled = controls.map((control) => control.disabled);
        modal.setAttribute("aria-busy", "true");
        controls.forEach((control) => {
          control.disabled = true;
        });
        try {
          await store.saveConfig(value, expectedRevision);
        } finally {
          controls.forEach((control, index) => {
            control.disabled = disabled[index];
          });
          modal.removeAttribute("aria-busy");
        }
        if (disposed || context.signal.aborted) return false;
        saved = true;
        onSaved();
        return true;
      } catch (failure) {
        error.textContent = errorText(context, failure);
        return false;
      }
    }
    function dispose(): void {
      if (disposed) return;
      disposed = true;
      if (modal.open) modal.close();
      modal.remove();
      unmount();
      if (dialog === modal) {
        dialog = undefined;
        requestClose = undefined;
        disposeEditor = undefined;
      }
      if (previousFocus?.isConnected && !context.signal.aborted)
        previousFocus.focus({ preventScroll: true });
    }
    function saveAndClose(): Promise<boolean> {
      if (saving) return saving;
      saving = (async () => {
        if (!(await saveDraft())) return false;
        dispose();
        return true;
      })().finally(() => {
        saving = undefined;
      });
      return saving;
    }
    modal.addEventListener("cancel", (event) => {
      event.preventDefault();
      saveAndClose();
    });
    modal.addEventListener("close", () => {
      if (disposed) return;
      if (context.signal.aborted || !isActive()) dispose();
      else {
        modal.showModal();
        void saveAndClose();
      }
    });
    page.body.append(modal);
    dialog = modal;
    requestClose = saveAndClose;
    disposeEditor = dispose;
    renderFields();
    modal.showModal();
  }
  function close(): void {
    if (context.signal.aborted || !isActive()) disposeEditor?.();
    else void requestClose?.();
  }

  context.lifecycle.defer(close);
  return { open, close };
}
export type StateEditor = ReturnType<typeof createEditor>;
