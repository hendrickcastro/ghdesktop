import { Repository } from '../../models/repository'
import { IMenuItem } from '../../lib/menu-item'
import { Repositoryish } from './group-repositories'
import { clipboard } from 'electron'
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
    {
      label: __DARWIN__ ? 'Copy Repo Name' : 'Copy repo name',
      action: () => clipboard.writeText(repository.name),
    },
    {
      label: __DARWIN__ ? 'Copy Repo Path' : 'Copy repo path',
      action: () => clipboard.writeText(repository.path),
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
    ? (__DARWIN__ ? 'Remove from Favorites' : 'Remove from favorites')
    : (__DARWIN__ ? 'Add to Favorites' : 'Add to favorites')

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
  repository: Repository,
  config: IRepositoryListItemContextMenuConfig,
  parentId: number | null
): IMenuItem[] {
  const children = folders.filter(f => f.parentId === parentId)
  const items: IMenuItem[] = []

  for (const folder of children) {
    const subChildren = folders.filter(f => f.parentId === folder.id)

    if (subChildren.length > 0) {
      // Folder has subfolders — render as submenu
      const submenuItems: IMenuItem[] = [
        {
          label: __DARWIN__ ? 'Move Here' : 'Move here',
          type: 'checkbox' as const,
          checked: repository.folderId === folder.id,
          action: () =>
            config.onMoveToFolder(
              repository,
              repository.folderId === folder.id ? null : folder.id
            ),
        },
        { type: 'separator' },
        ...buildFolderTree(folders, repository, config, folder.id),
      ]
      items.push({
        label: folder.name,
        submenu: submenuItems,
      })
    } else {
      // Leaf folder — simple checkbox item
      items.push({
        label: folder.name,
        type: 'checkbox' as const,
        checked: repository.folderId === folder.id,
        action: () =>
          config.onMoveToFolder(
            repository,
            repository.folderId === folder.id ? null : folder.id
          ),
      })
    }
  }

  return items
}

const buildFolderMenuItems = (
  config: IRepositoryListItemContextMenuConfig
): ReadonlyArray<IMenuItem> => {
  const { repository } = config

  if (!(repository instanceof Repository)) {
    return []
  }

  const submenu: IMenuItem[] = buildFolderTree(
    config.folders,
    repository,
    config,
    null
  )

  if (submenu.length > 0) {
    submenu.push({ type: 'separator' })
  }

  submenu.push({
    label: __DARWIN__ ? 'New Folder…' : 'New folder…',
    action: () => config.onCreateFolder(null),
  })

  if (repository.folderId !== null) {
    submenu.push({ type: 'separator' })
    submenu.push({
      label: __DARWIN__ ? 'Remove from Folder' : 'Remove from folder',
      action: () => config.onMoveToFolder(repository, null),
    })
  }

  return [
    {
      label: __DARWIN__ ? 'Move to Folder' : 'Move to folder',
      submenu,
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
