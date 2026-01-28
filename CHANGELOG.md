# Changelog

All notable changes to this project will be documented in this file.

## 2026-01-28

### Changed
- **Default Entra App**: Updated the default Client ID to a dedicated application for the plugin. This ensures better community control, long-term stability, and removes dependence on the original author's personal client ID.

### Added
- **Translations**: Added support for German, French, Dutch, Spanish, Italian, Portuguese, and Polish languages (AI-translated, contributions welcome!)
- **Translation System**: Translation function now supports placeholders like `{pluginName}` for dynamic values

### Changed
- **Context Menu Simplified**: Cleaner right-click menu with clearer options:
  - "Push to default list" / "Push to list..."
  - "Insert tasks from list..."
  - "Sync all tasks"
  - "Refresh selected task" / "Open task in To Do app"
- **Default Settings**: 
  - Default list name is now "Obsidian Tasks" (was empty)
  - Auto-sync interval is now 10 minutes (was 30)
- **Sync Notifications**: Now shows plugin name and task count (e.g., "Microsoft To Do Sync: Sync complete - 5 task(s) updated")
- **Rate Limiting**: Added minimum 60-second interval between vault syncs to prevent API throttling (429 errors)
- **Settings UI**: Removed emojis from section headings, improved descriptions
- **Advanced Settings**: Redirect URI setting now hidden (only shown in developer mode)

### Fixed
- **Duplicate Lists**: Fixed bug where lists were always created even if they already existed (causing "List Name (1)" duplicates)

## 2026-01-27

### Security
- Updated `esbuild` and other dependencies to fix security vulnerabilities reported by `pnpm audit`.
- **Sanitization**: Replaced regex-based HTML stripping with `DOMParser` to address CodeQL security warnings regarding potential XSS vulnerabilities.

### Added
- **Auth Selection**: New users are now prompted to choose between the default Microsoft Entra App or a custom Client ID on first run.
- **List Selector Modal**: Choose which To Do list to insert tasks from (or "All Lists")
- **Auto-Sync on Plugin Start**: Syncs 5 seconds after Obsidian loads
- **Auto-Sync on File Save**: Syncs when saving files containing tracked tasks (`^MSTD...`)
- **Block ID Generation**: "Insert summary" now generates tracking IDs for two-way sync
- **Subtasks Support**: "Sync Task with details (Pull)" now fetches checklistItems via `$expand`
- **Auto-Sync**: Background synchronization with configurable interval.
- **Context Menu**: "Sync Task to specific list..." option to choose a target list when pushing.
- **Debug Logging**: Added a setting to enable/disable verbose debug logging to reduce console spam.

### Fixed
- **Zombie Process**: Fixed an issue where the initial sync timer was not cleared on plugin unload, causing duplicate syncs and authentication prompts during hot reloads.
- **New Task Cache**: Newly created tasks (Right Click -> Send to To Do) are now immediately cached, ensuring subsequent updates (like completion) sync correctly.
- **Cache File Location**: Moved `Microsoft_cache.json` and `mstd-tasks-delta.json` to the plugin directory to ensure clean uninstallation.
- **400 Bad Request Error**: Fixed `webUrl` validation for linkedResources (local IPs excluded)
- **linkedResources Creation**: Now created separately after task creation when blockLink is available
- **List Selector**: Fixed modal not returning selection (onClose override issue)
- **Block ID Generation**: Fixed async cacheTaskId not being awaited
- **Sync Reliability**: Added retry mechanism for failed delta syncs (falls back to full sync).
- **Completion State**: Implemented hash-based sync to prevent tasks from being incorrectly marked undone when files are touched but not modified.

### Changed
- Modernized GitHub Actions workflows (Node 20, pnpm 9, updated actions)
- Updated README with correct Entra App setup instructions
- Removed redundant workflow files
- **Task Formatting**: Default replacement format is now cleaner (`- [ ] Task Name`) without list name or creation date. (Includes migration for existing settings).
- **Rate Limiting**: Added a delay between list syncs to prevent "Too Many Requests" (429) errors.
- **Logging**: Further reduced log verbosity (only log "Updated Tasks" if > 0).



## [1.0.1] - Previous

### Added
- Initial sync functionality
- Push/Pull tasks to Microsoft To Do
- Delta sync support
- Settings UI

## [1.0.0] - Initial Release

### Added
- Basic Microsoft To Do integration
- Task creation and synchronization
- Obsidian block ID linking
