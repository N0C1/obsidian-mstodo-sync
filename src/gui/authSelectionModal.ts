import { type App, Modal, Setting } from 'obsidian';

export class AuthSelectionModal extends Modal {
    private customClientId = '';

    constructor(
        app: App,
        private readonly onSubmit: (result: 'default' | 'custom', clientId?: string) => void,
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Microsoft To Do Authentication' });
        contentEl.createEl('p', { text: 'Choose how you want to connect to Microsoft To Do.' });

        const buttonContainer = contentEl.createDiv('auth-selection-buttons');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.flexDirection = 'column';
        buttonContainer.style.gap = '10px';

        new Setting(buttonContainer)
            .setName('Use Default App')
            .setDesc('Quickest way to get started. Uses the bundled Microsoft Entra App.')
            .addButton((btn) =>
                btn
                    .setButtonText('Use Default App')
                    .setCta()
                    .onClick(() => {
                        this.onSubmit('default');
                        this.close();
                    }),
            );

        new Setting(buttonContainer)
            .setName('Use Custom App')
            .setDesc('For advanced users. Requires your own Client ID from Azure.')
            .addButton((btn) =>
                btn.setButtonText('Configure Custom App').onClick(() => {
                    this.showCustomAppInput(contentEl);
                }),
            );
    }

    showCustomAppInput(contentEl: HTMLElement) {
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Custom Client ID' });

        new Setting(contentEl)
            .setName('Client ID')
            .setDesc('Enter your Application (client) ID')
            .addText((text) => text.onChange((value) => (this.customClientId = value)));

        new Setting(contentEl).addButton((btn) =>
            btn
                .setButtonText('Save')
                .setCta()
                .onClick(() => {
                    if (this.customClientId) {
                        this.onSubmit('custom', this.customClientId);
                        this.close();
                    }
                }),
        );
    }

    onClose() {
        this.contentEl.empty();
    }
}
