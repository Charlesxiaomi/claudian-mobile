import { App, Modal } from "obsidian";

import { t } from "@/i18n";

/**
 * Lets the user pick which model id to test against the configured endpoint,
 * runs the test, and shows the outcome inline. A picker exists because
 * testing one model only proves that one model — the user should see exactly
 * what passed, and be able to try the others without reopening the modal.
 */
export class ModelTestModal extends Modal {
  private running = false;

  constructor(
    app: App,
    private readonly models: string[],
    /** Resolves when the model passed; rejects with the gateway's error detail. */
    private readonly runTest: (model: string) => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(t().settings.testModalTitle);
    const list = this.contentEl.createDiv({ cls: "claudian-mobile-test-models" });
    const status = this.contentEl.createDiv({ cls: "claudian-mobile-test-status" });
    const buttons: HTMLButtonElement[] = [];
    for (const model of this.models) {
      const button = list.createEl("button", { text: model });
      buttons.push(button);
      button.addEventListener("click", () => void this.run(model, status, buttons));
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async run(model: string, status: HTMLElement, buttons: HTMLButtonElement[]): Promise<void> {
    if (this.running) return;
    this.running = true;
    for (const button of buttons) button.disabled = true;
    const s = t().settings;
    status.classList.remove("is-success", "is-failure");
    status.setText(s.testRunning(model));
    try {
      await this.runTest(model);
      status.classList.add("is-success");
      status.setText(s.testSuccess(model));
    } catch (err) {
      status.classList.add("is-failure");
      status.setText(s.testFailed(model, err instanceof Error ? err.message : String(err)));
    } finally {
      this.running = false;
      for (const button of buttons) button.disabled = false;
    }
  }
}
