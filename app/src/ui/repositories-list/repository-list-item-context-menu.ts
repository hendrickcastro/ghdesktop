import { Repository } from '../../models/repository'
import { IMenuItem } from '../../lib/menu-item'
import { Repositoryish } from './group-repositories'
import { writeClipboardText } from '../main-process-proxy'
import {
  RevealInFileManagerLabel,
  DefaultEditorLabel,
  DefaultShellLabel,
} from '../lib/context-menu'
import { IRepositoryFolder } from '../../models/repository-folder'

interface IRepositoryListItemContextMenuConfig {
  repository: Repositoryish
  shellLabel: string | undefined
  externalEditorLabel: string | undefined
  askForConfirmationOnRemoveRepository: boolean
  onViewOnGitHub: (repository: Repositoryish) => void
  onOpenInShell: (repository: Repositoryish) => void
  onShowRepository: (repository: Repositoryish) => void
  onOpenInExternalEditor: (repository: Repositoryish) => void
  onRemoveRepository: (repository: Repositoryish) => void
  onChangeRepositoryAlias: (repository: Repository) => void
  onRemoveRepositoryAlias: (repository: Repository) => void
  onToggleFavorite: (repository: Repository) => void
  onMoveToFolder: (repository: Repository, folderId: number | null) => void
  onCreateFolder: (parentId?: number | null) => void
  folders: ReadonlyArray<IRepositoryFolder>
  onCreateWorktree?: (repository: Repository) => void
  onShowWorktrees?: (repository: Repository) => void
}

export const generateRepositoryListContextMenu = (
  config: IRepositoryListItemContextMenuConfig
) => {
  const { repository } = config
  const missing = repository instanceof Repository && repository.missing
  const github =
    repository instanceof Repository && repository.gitHubRepository != null
  const openInExternalEditor = config.externalEditorLabel
    ? `Open in ${config.externalEditorLabel}`
    : DefaultEditorLabel
  const openInShell = config.shellLabel
    ? `Open in ${config.shellLabel}`
    : DefaultShellLabel

  const items: ReadonlyArray<IMenuItem> = [
    ...buildFavoriteMenuItem(config),
    ...buildFolderMenuItems(config),
    ...buildAliasMenuItems(config),
    ...buildWorktreeMenuItems(config),
    {
      label: __DARWIN__ ? 'Copy Repo Name' : 'Copy repo name',
      action: () => writeClipboardText(repository.name),
    },
    {
      label: __DARWIN__ ? 'Copy Repo Path' : 'Copy repo path',
      action: () => writeClipboardText(repository.path),
    },
    { type: 'separator' },
    {
      label: 'View on GitHub',
      action: () => config.onViewOnGitHub(repository),
      enabled: github,
    },
    {
      label: openInShell,
      action: () => config.onOpenInShell(repository),
      enabled: !missing,
    },
    {
      label: RevealInFileManagerLabel,
      action: () => config.onShowRepository(repository),
      enabled: !missing,
    },
    {
      label: openInExternalEditor,
      action: () => config.onOpenInExternalEditor(repository),
      enabled: !missing,
    },
    { type: 'separator' },
    {
      label: config.askForConfirmationOnRemoveRepository ? 'Remove…' : 'Remove',
      action: () => config.onRemoveRepository(repository),
    },
  ]

  return items
}

const buildFavoriteMenuItem = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config

  if (!(repository instanceof Repository)) {
    return []
  }

  const label = repository.isFavorite
    ? __DARWIN__
      ? 'Remove from Favorites'
      : 'Remove from favorites'
    : __DARWIN__
    ? 'Add to Favorites'
    : 'Add to favorites'

  return [
    {
      label,
      action: () => config.onToggleFavorite(repository),
    },
  ]
}

/**
 * Build a tree-structured folder submenu. Root folders appear at top level,
 * subfolders appear as nested submenus under their parent.
 */
function buildFolderTree(
  folders: ReadonlyArray<IRepositoryFolder>,
  repositories: ReadonlyArray<Repository>,
  onMove: (folderId: number | null) => void,
  parentId: number | null
): IMenuItem[] {
  const children = folders.filter(f => f.parentId === parentId)
  const items: IMenuItem[] = []

  for (const folder of children) {
    const subChildren = folders.filter(f => f.parentId === folder.id)

    // Checked when every repository is already there; choosing it again takes
    // them out of the folder.
    const checked = repositories.every(r => r.folderId === folder.id)
    const moveHere = {
      type: 'checkbox' as const,
      checked,
      action: () => onMove(checked ? null : folder.id),
    }

    if (subChildren.length > 0) {
      // Folder has subfolders — render as submenu
      const submenuItems: IMenuItem[] = [
        { label: __DARWIN__ ? 'Move Here' : 'Move here', ...moveHere },
        { type: 'separator' },
        ...buildFolderTree(folders, repositories, onMove, folder.id),
      ]
      items.push({
        label: folder.name,
        submenu: submenuItems,
      })
    } else {
      // Leaf folder — simple checkbox item
      items.push({ label: folder.name, ...moveHere })
    }
  }

  return items
}

/**
 * The folder submenu for one or more repositories: every folder to move them
 * to, a new folder, and taking them out of their folder when any is in one.
 */
export function buildRepositoriesFolderMenu(
  folders: ReadonlyArray<IRepositoryFolder>,
  repositories: ReadonlyArray<Repository>,
  onMove: (folderId: number | null) => void,
  onCreateFolder: () => void
): IMenuItem[] {
  const submenu = buildFolderTree(folders, repositories, onMove, null)

  if (submenu.length > 0) {
    submenu.push({ type: 'separator' })
  }

  submenu.push({
    label: __DARWIN__ ? 'New Folder…' : 'New folder…',
    action: onCreateFolder,
  })

  if (repositories.some(r => r.folderId !== null)) {
    submenu.push({ type: 'separator' })
    submenu.push({
      label: __DARWIN__ ? 'Remove from Folder' : 'Remove from folder',
      action: () => onMove(null),
    })
  }

  return submenu
}

const buildFolderMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config

  if (!(repository instanceof Repository)) {
    return []
  }

  return [
    {
      label: __DARWIN__ ? 'Move to Folder' : 'Move to folder',
      submenu: buildRepositoriesFolderMenu(
        config.folders,
        [repository],
        folderId => config.onMoveToFolder(repository, folderId),
        () => config.onCreateFolder(null)
      ),
    },
  ]
}

const buildAliasMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config

  if (!(repository instanceof Repository)) {
    return []
  }

  const verb = repository.alias == null ? 'Create' : 'Change'
  const items: Array<IMenuItem> = [
    {
      label: __DARWIN__ ? `${verb} Alias` : `${verb} alias`,
      action: () => config.onChangeRepositoryAlias(repository),
    },
  ]

  if (repository.alias !== null) {
    items.push({
      label: __DARWIN__ ? 'Remove Alias' : 'Remove alias',
      action: () => config.onRemoveRepositoryAlias(repository),
    })
  }

  return items
}

const buildWorktreeMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository, onCreateWorktree, onShowWorktrees } = config

  if (!(repository instanceof Repository)) {
    return []
  }

  if (onCreateWorktree === undefined && onShowWorktrees === undefined) {
    return []
  }

  const items: Array<IMenuItem> = []

  if (onShowWorktrees !== undefined) {
    items.push({
      label: __DARWIN__ ? 'Show Worktrees' : 'Show worktrees',
      action: () => onShowWorktrees(repository),
    })
  }

  if (onCreateWorktree !== undefined) {
    items.push({
      label: __DARWIN__ ? 'New Worktree…' : 'New worktree…',
      action: () => onCreateWorktree(repository),
    })
  }

  return items
}
