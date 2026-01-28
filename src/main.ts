import { type CachedMetadata, type Editor, type MarkdownFileInfo, type MarkdownView, Plugin } from 'obsidian';
import { TodoApi } from './api/todoApi.js';
import { DEFAULT_SETTINGS, MsTodoSyncSettingTab, type IMsTodoSyncSettings } from './gui/msTodoSyncSettingTab.js';
import { createTodayTasks, getAllTasksInList } from './command/msTodoCommand.js';
import { t } from './lib/lang.js';
import { log, logging } from './lib/logging.js';
import { SettingsManager } from './utils/settingsManager.js';
import { MicrosoftClientProvider } from './api/microsoftClientProvider.js';
import { type IUserNotice, UserNotice } from './lib/userNotice.js';
import { MsTodoActions } from './command/msToDoActions.js';
import { ListSelectorModal } from './gui/listSelectorModal.js';
import { AuthSelectionModal } from './gui/authSelectionModal.js';

export default class MsTodoSync extends Plugin {
    settings!: IMsTodoSyncSettings;
    userNotice!: IUserNotice;
    public todoApi!: TodoApi;
    public settingsManager!: SettingsManager;
    public microsoftClientProvider!: MicrosoftClientProvider;
    public msToDoActions!: MsTodoActions;
    private syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private autoSyncIntervalId: ReturnType<typeof setInterval> | null = null;
    private initialSyncTimer: ReturnType<typeof setTimeout> | null = null;
    private lastSyncedFile: string | null = null;
    private lastVaultSyncAt: number | null = null;
    private readonly minSyncIntervalMs = 60 * 1000; // minimum 60s between vault syncs

    // Pulls the meta data for the a page to help with list processing.
    getPageMetadata(path: string): CachedMetadata | undefined {
        return this.app.metadataCache.getCache(path) ?? undefined;
    }

    async onload() {
        logging.registerConsoleLogger();

        log('info', `loading plugin "${this.manifest.name}" v${this.manifest.version}`);
        this.userNotice = new UserNotice();

        await this.loadSettings();

        this.microsoftClientProvider = new MicrosoftClientProvider(this.app, this.manifest.dir || '.');
        this.todoApi = new TodoApi(this.microsoftClientProvider);
        this.settingsManager = new SettingsManager(this);
        this.msToDoActions = new MsTodoActions(this, this.settingsManager, this.todoApi);

        this.registerMenuEditorOptions();
        this.registerCommands();
        this.addSettingTab(new MsTodoSyncSettingTab(this.app, this, this.userNotice));

        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                this.handleFileSave(file.path);
            }),
        );

        if (!this.settings.authType) {
            const hasLegacyConfig = this.settings.microsoft_AuthenticationClientId !== '';
            const cachePath = `${this.manifest.dir}/Microsoft_cache.json`;
            const hasCache = await this.app.vault.adapter.exists(cachePath);

            if (hasLegacyConfig) {
                this.settings.authType = 'custom';
                await this.saveSettings();
            } else if (hasCache) {
                this.settings.authType = 'default';
                await this.saveSettings();
            } else {
                const modal = new AuthSelectionModal(this.app, async (result, clientId) => {
                    this.settings.authType = result;
                    if (result === 'custom' && clientId) {
                        this.settings.microsoft_AuthenticationClientId = clientId;
                    }
                    await this.saveSettings();
                    this.initializeProvider();
                    this.configureAutoSync();
                    this.triggerInitialSync();
                });
                modal.open();
                return;
            }
        }

        if (this.settings.authType) {
            this.initializeProvider();
            this.configureAutoSync();
            this.triggerInitialSync();
        }
    }

    initializeProvider() {
        try {
            if (this.settings.microsoft_AuthenticationClientId !== '') {
                this.microsoftClientProvider.clientId = this.settings.microsoft_AuthenticationClientId;
            }

            if (this.settings.microsoft_AuthenticationAuthority !== '') {
                this.microsoftClientProvider.authority = this.settings.microsoft_AuthenticationAuthority;
            }

            this.microsoftClientProvider.createPublicClientApplication();
        } catch (error) {
            if (error instanceof Error) {
                this.userNotice.showMessage(t('Error_ProviderInitializationFailed'));
                log('error', error.message);
                log('error', error.stack ?? 'No stack trace available');
            }
        }
    }

    /**
     * Triggers a vault sync but enforces a minimum interval between syncs to
     * avoid flooding the Microsoft Graph API (e.g., 429 Too Many Requests).
     */
    private async safeSyncVault(reason: string) {
        const now = Date.now();
        if (this.lastVaultSyncAt && now - this.lastVaultSyncAt < this.minSyncIntervalMs) {
            const secondsSinceLast = Math.round((now - this.lastVaultSyncAt) / 1000);
            log(
                'info',
                `Skipping vault sync (${reason}); last sync was ${secondsSinceLast}s ago (min interval ${
                    this.minSyncIntervalMs / 1000
                }s).`,
            );
            return;
        }

        this.lastVaultSyncAt = now;

        try {
            await this.msToDoActions.syncVault();
        } catch (error) {
            log('error', `Vault sync (${reason}) failed:`, error);
        }
    }

    triggerInitialSync() {
        this.app.workspace.onLayoutReady(() => {
            this.initialSyncTimer = setTimeout(() => {
                log('info', 'Running initial sync on plugin start...');
                this.safeSyncVault('initial');
            }, 5000);
        });
    }

    /**
     * Handles file save events - triggers sync if file contains tracked tasks.
     * Uses debouncing to avoid syncing too frequently.
     */
    private handleFileSave(filePath: string) {
        // Only process markdown files
        if (!this.settings.authType || !filePath.endsWith('.md')) {
            return;
        }

        // Debounce: wait 3 seconds after last save before syncing
        if (this.syncDebounceTimer) {
            clearTimeout(this.syncDebounceTimer);
        }

        this.syncDebounceTimer = setTimeout(async () => {
            try {
                // Read file content to check for task block IDs
                const content = await this.app.vault.adapter.read(filePath);
                const hasTrackedTasks = /\^MSTD[A-Za-z\d]+/.test(content);

                if (hasTrackedTasks && filePath !== this.lastSyncedFile) {
                    log('info', `File with tracked tasks saved: ${filePath}, requesting sync...`);
                    this.lastSyncedFile = filePath;
                    await this.safeSyncVault('file-save');
                    // Reset after sync completes to allow future syncs
                    setTimeout(() => {
                        this.lastSyncedFile = null;
                    }, 10000); // Prevent re-sync of same file for 10 seconds
                }
            } catch (error) {
                log('error', 'Error checking file for tracked tasks:', error);
            }
        }, 3000); // 3 second debounce
    }

    async onunload() {
        log('info', `unloading plugin "${this.manifest.name}" v${this.manifest.version}`);
        // Clean up debounce timer
        if (this.syncDebounceTimer) {
            clearTimeout(this.syncDebounceTimer);
        }
        if (this.autoSyncIntervalId) {
            clearInterval(this.autoSyncIntervalId);
        }
        if (this.initialSyncTimer) {
            clearTimeout(this.initialSyncTimer);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

        // Ensure logging options are set correctly based on loaded settings
        if (this.settings.debugLogging) {
            this.settings.loggingOptions.minLevels['mstodo-sync'] = 'debug';
        } else {
            this.settings.loggingOptions.minLevels['mstodo-sync'] = 'info';
        }
        logging.configure(this.settings.loggingOptions);

        // Migration: Update replacement format if it matches the old default or contains unwanted placeholders
        const oldDefaultFormat =
            '- [{{STATUS_SYMBOL}}] {{TASK}}{{IMPORTANCE}}{{TASK_LIST_NAME}}{{DUE_DATE}}{{CREATED_DATE}}';
        const currentFormat = this.settings.displayOptions_ReplacementFormat;

        if (
            currentFormat === oldDefaultFormat ||
            currentFormat.includes('{{TASK_LIST_NAME}}') ||
            currentFormat.includes('{{CREATED_DATE}}')
        ) {
            log('info', 'Migrating replacement format settings to new default.');
            this.settings.displayOptions_ReplacementFormat = DEFAULT_SETTINGS.displayOptions_ReplacementFormat;
            await this.saveSettings();
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    public configureAutoSync() {
        if (this.autoSyncIntervalId) {
            clearInterval(this.autoSyncIntervalId);
            this.autoSyncIntervalId = null;
        }

        const intervalMinutes = this.settings.autoSyncInterval;
        if (intervalMinutes && intervalMinutes > 0) {
            log('info', `Configuring auto-sync every ${intervalMinutes} minutes`);
            this.autoSyncIntervalId = setInterval(
                () => {
                    log('info', 'Running auto-sync...');
                    this.safeSyncVault('auto');
                },
                intervalMinutes * 60 * 1000,
            );
        } else {
            log('info', 'Auto-sync disabled');
        }
    }

    /**
     * Registers commands for the plugin.
     *
     * This method adds the following commands:
     *
     * - `only-create-task`: Posts the selected text as tasks to Microsoft To-Do.
     * - `create-task-replace`: Posts the selected text as tasks to Microsoft To-Do and replaces the selected text.
     * - `open-task-link`: Opens the link to the task in Microsoft To-Do.
     * - `add-microsoft-todo`: Inserts a summary of today's tasks from Microsoft To-Do.
     *
     * Each command is associated with an `editorCallback` that defines the action to be performed when the command is executed.
     *
     * @private
     */
    private registerCommands() {
        this.addCommand({
            id: 'only-create-task',
            name: t('CommandName_PushToMsTodo'),
            editorCallback: async (editor: Editor, _view: MarkdownView | MarkdownFileInfo) => {
                await this.pushTaskToMsTodo(editor);
            },
        });

        // 注册命令：将选中的文字创建微软待办并替换
        // Register command: Create and replace the selected text to Microsoft To-Do
        this.addCommand({
            id: 'create-task-replace',
            name: t('CommandName_PushToMsTodoAndReplace'),
            editorCallback: async (editor: Editor, _view: MarkdownView | MarkdownFileInfo) => {
                await this.pushTaskToMsTodoAndUpdatePage(editor);
            },
        });

        // Register command: Open link to ToDo
        this.addCommand({
            id: 'open-task-link',
            name: t('CommandName_OpenToDo'),
            editorCallback: async (editor: Editor, _view: MarkdownView | MarkdownFileInfo) => {
                this.msToDoActions.viewTaskInTodo(editor);
            },
        });

        this.addCommand({
            id: 'add-microsoft-todo',
            name: t('CommandName_InsertSummary'),
            editorCallback: async (editor: Editor, _view: MarkdownView | MarkdownFileInfo) => {
                // Show list selector modal
                const lists = await this.todoApi.getLists();
                if (!lists || lists.length === 0) {
                    this.userNotice.showMessage('No lists found');
                    return;
                }

                const modal = new ListSelectorModal(this.app, lists);
                const result = await modal.openAndGetValue();

                if (result.cancelled) {
                    return;
                }

                // result.list is null for "All Lists", or a specific list
                // If "All Lists" is selected (null), pass empty string to signify "All Lists" explicitely
                // If it were undefined, createTodayTasks would fall back to settings default list
                const filterListName = result.list?.displayName ?? '';
                await createTodayTasks(this.todoApi, this, editor, filterListName);
            },
        });

        if (this.settings.hackingEnabled) {
            this.addCommand({
                id: 'sync-vault',
                name: 'Sync Vault',
                callback: async () => {
                    this.msToDoActions.syncVault();
                },
            });
        }
    }

    /**
     * Registers various options in the editor's context menu.
     *
     * This method adds multiple items to the editor's right-click context menu, each performing different actions related to Microsoft To-Do integration:
     *
     * - Sync selected text to Microsoft To-Do.
     * - Sync and replace selected text with a Microsoft To-Do task.
     * - Sync task with details (Push).
     * - Sync task with details (Pull).
     * - Open Microsoft To-Do task details.
     *
     * Each menu item triggers an asynchronous function to handle the respective action.
     *
     * @private
     */
    private registerMenuEditorOptions() {
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, _view) => {
                menu.addSeparator();
                menu.addItem((microsoftToDoItem) => {
                    microsoftToDoItem.setTitle('Microsoft To Do');
                    microsoftToDoItem.setIcon('check-check');

                    const microsoftToDoSubmenu = microsoftToDoItem.setSubmenu();

                    // Push to default list (or show list selector if no default)
                    microsoftToDoSubmenu.addItem((item) => {
                        item.setTitle(t('EditorMenu_PushToDefaultList')).onClick(async () => {
                            if (!this.settings.todoListSync?.listId) {
                                // No default list - show selector
                                const lists = await this.todoApi.getLists();
                                if (!lists || lists.length === 0) {
                                    this.userNotice.showMessage(t('General_NoListNameSet'));
                                    return;
                                }
                                const modal = new ListSelectorModal(this.app, lists, false);
                                const result = await modal.openAndGetValue();
                                if (result.cancelled || !result.list) return;
                                await this.msToDoActions.postTask(editor, true, result.list.id);
                            } else {
                                await this.pushTaskToMsTodoAndUpdatePage(editor);
                            }
                        });
                    });

                    // Push to specific list (always show selector)
                    microsoftToDoSubmenu.addItem((item) => {
                        item.setTitle(t('EditorMenu_PushToSelectList')).onClick(async () => {
                            const lists = await this.todoApi.getLists();
                            if (!lists || lists.length === 0) {
                                this.userNotice.showMessage(t('General_NoListNameSet'));
                                return;
                            }
                            const modal = new ListSelectorModal(this.app, lists, false);
                            const result = await modal.openAndGetValue();
                            if (result.cancelled || !result.list) return;
                            await this.msToDoActions.postTask(editor, true, result.list.id);
                        });
                    });

                    microsoftToDoSubmenu.addSeparator();

                    // Insert tasks from a list
                    microsoftToDoSubmenu.addItem((item) => {
                        item.setTitle(t('EditorMenu_InsertTasksFromList')).onClick(async () => {
                            const lists = await this.todoApi.getLists();
                            if (!lists || lists.length === 0) {
                                this.userNotice.showMessage(t('General_NoListNameSet'));
                                return;
                            }
                            const modal = new ListSelectorModal(this.app, lists);
                            const result = await modal.openAndGetValue();
                            if (result.cancelled) return;
                            const filterListName = result.list?.displayName ?? '';
                            await createTodayTasks(this.todoApi, this, editor, filterListName);
                        });
                    });

                    microsoftToDoSubmenu.addSeparator();

                    // Sync all tasks
                    microsoftToDoSubmenu.addItem((item) => {
                        item.setTitle(t('EditorMenu_SyncAll')).onClick(async () => {
                            await this.safeSyncVault('manual');
                        });
                    });

                    microsoftToDoSubmenu.addSeparator();

                    // Refresh selected task (update local from remote)
                    microsoftToDoSubmenu.addItem((item) => {
                        item.setTitle(t('EditorMenu_RefreshTask')).onClick(async () => {
                            await this.msToDoActions.getTask(this.settings.todoListSync?.listId, editor);
                        });
                    });

                    // Open in To Do app
                    microsoftToDoSubmenu.addItem((item) => {
                        item.setTitle(t('EditorMenu_OpenToDo')).onClick(async () => {
                            this.msToDoActions.viewTaskInTodo(editor);
                        });
                    });
                });
            }),
        );

        if (this.settings.hackingEnabled) {
            this.registerEvent(
                this.app.workspace.on('editor-menu', (menu, editor, _view) => {
                    menu.addItem((microsoftToDoItem) => {
                        microsoftToDoItem.setTitle('Microsoft To-Do - Hacking');
                        microsoftToDoItem.setIcon('skull');

                        const microsoftToDoSubmenu = microsoftToDoItem.setSubmenu();
                        microsoftToDoSubmenu.addItem((item) => {
                            item.setTitle('Testing Commands Enabled');
                        });
                        microsoftToDoSubmenu.addSeparator();

                        microsoftToDoSubmenu.addItem((item) => {
                            item.setTitle('Sync Vault').onClick(async () => {
                                this.msToDoActions.syncVault();
                            });
                        });

                        microsoftToDoSubmenu.addItem((item) => {
                            item.setTitle('Update Task Cache').onClick(async () => {
                                //await this.msToDoActions.getTaskDelta(this.todoApi, this.settings.todoListSync?.listId, this);
                            });
                        });

                        microsoftToDoSubmenu.addItem((item) => {
                            item.setTitle('Reset Task Cache').onClick(async () => {
                                await this.msToDoActions.resetTasksCache();
                            });
                        });

                        microsoftToDoSubmenu.addItem((item) => {
                            item.setTitle('Cleanup Local Task Lookup Table').onClick(async () => {
                                await this.msToDoActions.cleanupCachedTaskIds();
                            });
                        });

                        microsoftToDoSubmenu.addItem((item) => {
                            item.setTitle('Insert all tasks with body').onClick(async () => {
                                await getAllTasksInList(
                                    this.todoApi,
                                    this.settings.todoListSync?.listId,
                                    editor,
                                    this,
                                    true,
                                );
                            });
                        });

                        microsoftToDoSubmenu.addItem((item) => {
                            item.setTitle('Insert all tasks').onClick(async () => {
                                await getAllTasksInList(
                                    this.todoApi,
                                    this.settings.todoListSync?.listId,
                                    editor,
                                    this,
                                    false,
                                );
                            });
                        });

                        microsoftToDoSubmenu.addItem((item) => {
                            item.setTitle('Add Missing Tasks').onClick(async () => {
                                this.msToDoActions.addMissingTasksToVault(editor);
                            });
                        });
                    });
                }),
            );
        }
    }

    /**
     * Pushes a task to Microsoft To-Do and updates the page.
     *
     * This method posts a task to the Microsoft To-Do API using the provided editor instance,
     * the active file's path, and the current settings. After posting the task, it updates
     * the page accordingly.
     *
     * @param editor - The editor instance containing the task to be posted.
     * @returns A promise that resolves when the task has been posted and the page updated.
     */
    private async pushTaskToMsTodoAndUpdatePage(editor: Editor) {
        await this.msToDoActions.postTask(editor, true);
    }

    /**
     * Pushes a task to Microsoft To-Do.
     *
     * @param editor - The editor instance containing the task to be pushed.
     * @returns A promise that resolves when the task has been successfully pushed.
     */
    private async pushTaskToMsTodo(editor: Editor) {
        await this.msToDoActions.postTask(editor, false);
    }
}
