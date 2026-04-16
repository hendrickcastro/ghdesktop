# Repository Favorites & Custom Folders

## Overview

Two new features added to the repository sidebar:

1. **Favorites** - Mark any repository as a favorite. Favorites appear in a dedicated "Favorites" section at the top of the sidebar with a gold star icon.
2. **Custom Folders** - Create named folders and group repositories into them. Folder groups appear between Favorites/Recent and the normal dotcom/enterprise/other groups. Folders can be collapsed and expanded.

---

## Database Changes

**File:** `app/src/lib/databases/repositories-database.ts`

- Added `IDatabaseRepositoryFolder` interface with `id` (auto-increment) and `name` fields
- Added `isFavorite?: boolean` and `folderId?: number | null` fields to `IDatabaseRepository`
- Added `repositoryFolders` Dexie table declaration on `RepositoriesDatabase`
- Added schema version 10: `repositoryFolders: '++id, &name'`

---

## Models

**File:** `app/src/models/repository.ts`

- Added `isFavorite: boolean = false` constructor parameter
- Added `folderId: number | null = null` constructor parameter
- Both included in `createEqualityHash()` for change detection

**New file:** `app/src/models/repository-folder.ts`

- `IRepositoryFolder` interface: `{ id: number; name: string }`

---

## Data Layer (Stores)

### RepositoriesStore

**File:** `app/src/lib/stores/repositories-store.ts`

- Updated `toRepository()` to pass `isFavorite` and `folderId` from DB record
- Updated all `new Repository(...)` calls to propagate `isFavorite` and `folderId`
- New methods:
  - `updateRepositoryFavorite(repository, isFavorite)` - toggles favorite status
  - `updateRepositoryFolder(repository, folderId)` - assigns/removes folder
  - `getAllFolders()` - returns all folders from DB
  - `createFolder(name)` - creates a new folder
  - `renameFolder(id, name)` - renames a folder
  - `deleteFolder(id)` - deletes folder and unassigns all repos from it

### AppStore

**File:** `app/src/lib/stores/app-store.ts`

- Added `repositoryFolders` field and included in `getState()`
- Loads folders on init via `repositoriesStore.getAllFolders()`
- Pass-through methods: `_toggleRepositoryFavorite`, `_setRepositoryFolder`, `_createFolder`, `_renameFolder`, `_deleteFolder`
- Refreshes folder cache and emits updates after mutations

### IAppState

**File:** `app/src/lib/app-state.ts`

- Added `repositoryFolders: ReadonlyArray<IRepositoryFolder>` field

---

## Dispatcher

**File:** `app/src/ui/dispatcher/dispatcher.ts`

New public methods delegating to AppStore:

- `toggleRepositoryFavorite(repository)` - toggle favorite on/off
- `setRepositoryFolder(repository, folderId)` - move repo to folder or remove from folder (`null`)
- `createFolder(name)` - create new folder
- `renameFolder(id, name)` - rename existing folder
- `deleteFolder(id)` - delete folder

---

## Grouping Logic

**File:** `app/src/ui/repositories-list/group-repositories.ts`

Expanded `RepositoryListGroup` union type with two new kinds:

| Kind | Sort Prefix | Description |
|------|-------------|-------------|
| `favorites` | `0:favorites` | Gold star section at top |
| `folder` | `1:folder:{name}` | Custom folder sections |
| `recent` | `2:recent` | Existing recent repos |
| `dotcom` | `3:dotcom:{owner}` | GitHub.com repos |
| `enterprise` | `4:enterprise:{host}` | GitHub Enterprise repos |
| `other` | `5:other` | Local-only repos |

**Behavior:**
- **Favorites** appear in BOTH the Favorites section AND their normal group (like Recent)
- **Folder repos** appear ONLY in their folder group (removed from normal group via `continue`)
- Disambiguation logic updated to skip favorites and folder groups

---

## Folder Dialog

**New file:** `app/src/ui/folder-dialog/folder-dialog.tsx`

- Reusable dialog for both creating and renaming folders
- Props: `dispatcher`, optional `folderId` + `currentName` (for rename mode)
- Uses `Dialog`, `DialogContent`, `DialogFooter`, `OkCancelButtonGroup`, `TextBox`

**File:** `app/src/models/popup.ts`

- Added `PopupType.CreateRepositoryFolder`
- Added `PopupType.RenameRepositoryFolder` (with `folderId` and `currentName` payload)

---

## Context Menu

**File:** `app/src/ui/repositories-list/repository-list-item-context-menu.ts`

Extended the right-click context menu with:

- **"Add to Favorites" / "Remove from Favorites"** - toggles favorite status (top of menu)
- **"Move to Folder"** submenu:
  - List of existing folders with checkbox for current assignment
  - Separator
  - "New Folder..." option to create a folder inline
  - "Remove from Folder" option (shown only when repo is in a folder)

---

## UI Components

### RepositoryListItem

**File:** `app/src/ui/repositories-list/repository-list-item.tsx`

- Added `isFavorite: boolean` prop
- Renders gold star (`octicons.starFill`) in `repo-indicators` area when favorited
- Updated `shouldComponentUpdate` to check `isFavorite`

### RepositoriesList

**File:** `app/src/ui/repositories-list/repositories-list.tsx`

- Added `repositoryFolders` prop (from `IAppState`)
- Passes folders to `groupRepositories()` and context menu generator
- Updated `getGroupLabel()` and `renderGroupHeader()` for favorites (star icon) and folder (folder icon) groups
- **Collapse/Expand**: `collapsedGroups` state tracks which groups are collapsed; folder and favorites group headers are clickable with a chevron that rotates on toggle
- Wired context menu callbacks: `onToggleFavorite`, `onMoveToFolder`, `onCreateFolder`

### SectionFilterList

**File:** `app/src/ui/lib/section-filter-list.tsx`

- Added `isGroupCollapsed?: (identifier: GroupIdentifier) => boolean` prop
- Modified `createStateUpdate` to skip item rows for collapsed groups (header-only section)

### App

**File:** `app/src/ui/app.tsx`

- Imported `FolderDialog` and renders it for `CreateRepositoryFolder` / `RenameRepositoryFolder` popups
- Passes `repositoryFolders` prop to `<RepositoriesList>`
- Updated `onRepositoryToolbarButtonContextMenu` with folder/favorite callbacks

---

## Styling

**File:** `app/styles/ui/_repository-list.scss`

- `.favorite-indicator` - gold star icon (12px, `#d4a017`)
- `.group-header-icon` with `.favorites-icon` (gold) and `.folder-icon` (secondary text color) variants
- `.collapsible` group headers with `.collapse-chevron` - animated 90deg rotation on expand/collapse
- `.collapsed` state rotates chevron back to 0deg

---

## Tests

**File:** `app/test/unit/ui/repository-list-item-test.tsx`

- Updated all 3 `<RepositoryListItem>` test instances with `isFavorite={false}` to match new required prop

---

## Files Changed Summary

| File | Action |
|------|--------|
| `app/src/lib/databases/repositories-database.ts` | Modified - schema v10 |
| `app/src/models/repository.ts` | Modified - new fields |
| `app/src/models/repository-folder.ts` | **Created** |
| `app/src/lib/stores/repositories-store.ts` | Modified - CRUD methods |
| `app/src/lib/stores/app-store.ts` | Modified - state + methods |
| `app/src/lib/app-state.ts` | Modified - new state field |
| `app/src/ui/dispatcher/dispatcher.ts` | Modified - new methods |
| `app/src/ui/repositories-list/group-repositories.ts` | Modified - new group kinds |
| `app/src/ui/folder-dialog/folder-dialog.tsx` | **Created** |
| `app/src/models/popup.ts` | Modified - new popup types |
| `app/src/ui/repositories-list/repository-list-item-context-menu.ts` | Modified - new menu items |
| `app/src/ui/repositories-list/repository-list-item.tsx` | Modified - favorite indicator |
| `app/src/ui/repositories-list/repositories-list.tsx` | Modified - collapse/expand + wiring |
| `app/src/ui/lib/section-filter-list.tsx` | Modified - collapse support |
| `app/src/ui/app.tsx` | Modified - popup cases + props |
| `app/styles/ui/_repository-list.scss` | Modified - new styles |
| `app/test/unit/ui/repository-list-item-test.tsx` | Modified - new prop |
