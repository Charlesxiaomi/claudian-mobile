import { App, Modal } from "obsidian";

import { t } from "@/i18n";

/**
 * Minimal yes/no modal. Used to guard the destructive "New" action, since
 * clearing the conversation also wipes it from the persisted plugin data
 * and cannot be undone.
 */
export class ConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly options: { title: string; message: string; confirmText: string },
    private readonly onResult: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.options.title);
    this.contentEl.createEl("p", { text: this.options.message });

    const buttons = this.contentEl.createDiv({ cls: "claudian-mobile-confirm-buttons" });
    const cancel = buttons.createEl("button", { text: t().modal.cancel });
    cancel.addEventListener("click", () => this.resolve(false));
    const confirm = buttons.createEl("button", { cls: "mod-warning", text: this.options.confirmText });
    confirm.addEventListener("click", () => this.resolve(true));
  }

  onClose(): void {
    this.contentEl.empty();
    // Dismissing by tapping outside / pressing Escape counts as "no".
    if (!this.resolved) this.onResult(false);
  }

  private resolve(confirmed: boolean): void {
    this.resolved = true;
    this.onResult(confirmed);
    this.close();
  }
}

export function confirmAction(
  app: App,
  options: { title: string; message: string; confirmText: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(app, options, resolve).open();
  });
}
