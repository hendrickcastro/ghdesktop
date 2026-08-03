import * as React from 'react'

import { RepositoryListItem } from './repository-list-item'
import {
  groupRepositories,
  IRepositoryListItem,
  Repositoryish,
  RepositoryListGroup,
  getGroupKey,
} from './group-repositories'
import { IFilterListGroup } from '../lib/filter-list'
import { IMatches } from '../../lib/fuzzy-find'
import { ILocalRepositoryState, Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { showContextualMenu } from '../../lib/menu-item'
import { IMenuItem } from '../../lib/menu-item'
import { PopupType } from '../../models/popup'
import { encodePathAsUrl } from '../../lib/path'
import { TooltippedContent } from '../lib/tooltipped-content'
import memoizeOne from 'memoize-one'
import { KeyboardShortcut } from '../keyboard-shortcut/keyboard-shortcut'
import { generateRepositoryListContextMenu } from '../repositories-list/repository-list-item-context-menu'
import { SectionFilterList } from '../lib/section-filter-list'
import { assertNever } from '../../lib/fatal-error'
import { IAheadBehind } from '../../models/branch'
import { IRepositoryFolder } from '../../models/repository-folder'
import classNames from 'classnames'
import { commitGrammar } from './repository-list-item'
import { getStringArray, setStringArray } from '../../lib/local-storage'

const BlankSlateImage = encodePathAsUrl(__dirname, 'static/empty-no-repo.svg')
const collapsedGroupsKey = 'collapsed-repo-groups'

interface IRepositoriesListProps {
  readonly selectedRepository: Repositoryish | null
  readonly repositories: ReadonlyArray<Repositoryish>
  readonly repositoryFolders: ReadonlyArray<IRepositoryFolder>

  /** A cache of the latest repository state values, keyed by the repository id */
  readonly localRepositoryStateLookup: ReadonlyMap<
    number,
    ILocalRepositoryState
  >

  /** Called when a repository has been selected. */
  readonly onSelectionChanged: (repository: Repositoryish) => void

  /** Whether the user has enabled the setting to confirm removing a repository from the app */
  readonly askForConfirmationOnRemoveRepository: boolean

  /** Called when the repository should be removed. */
  readonly onRemoveRepository: (repository: Repositoryish) => void

  /** Called when the repository should be shown in Finder/Explorer/File Manager. */
  readonly onShowRepository: (repository: Repositoryish) => void

  /** Called when the repository should be opened on GitHub in the default web browser. */
  readonly onViewOnGitHub: (repository: Repositoryish) => void

  /** Called when the repository should be shown in the shell. */
  readonly onOpenInShell: (repository: Repositoryish) => void

  /** Called when the repository should be opened in an external editor */
  readonly onOpenInExternalEditor: (repository: Repositoryish) => void

  /** The current external editor selected by the user */
  readonly externalEditorLabel?: string

  /** The label for the user's preferred shell. */
  readonly shellLabel?: string

  /** The callback to fire when the filter text has changed */
  readonly onFilterTextChanged: (text: string) => void

  /** The text entered by the user to filter their repository list */
  readonly filterText: string

  readonly dispatcher: Dispatcher
}

interface IRepositoriesListState {
  readonly newRepositoryMenuExpanded: boolean
  readonly selectedItem: IRepositoryListItem | null
  readonly collapsedGroups: ReadonlySet<string>
}

const RowHeight = 29

/**
 * Iterate over all groups until a list item is found that matches
 * the id of the provided repository.
 */
function findMatchingListItem(
  groups: ReadonlyArray<
    IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
  >,
  selectedRepository: Repositoryish | null
) {
  if (selectedRepository !== null) {
    for (const group of groups) {
      for (const item of group.items) {
        if (item.repository.id === selectedRepository.id) {
          return item
        }
      }
    }
  }

  return null
}

/** The list of user-added repositories. */
export class RepositoriesList extends React.Component<
  IRepositoriesListProps,
  IRepositoriesListState
> {
  /**
   * A memoized function for grouping repositories for display
   * in the FilterList. The group will not be recomputed as long
   * as the provided list of repositories is equal to the last
   * time the method was called (reference equality).
   */
  private getRepositoryGroups = memoizeOne(
    (
      repositories: ReadonlyArray<Repositoryish> | null,
      localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
      repositoryFolders: ReadonlyArray<IRepositoryFolder>
    ) =>
      repositories === null
        ? []
        : groupRepositories(
            repositories,
            localRepositoryStateLookup,
            repositoryFolders
          )
  )

  /**
   * A memoized function for finding the selected list item based
   * on an IAPIRepository instance. The selected item will not be
   * recomputed as long as the provided list of repositories and
   * the selected data object is equal to the last time the method
   * was called (reference equality).
   *
   * See findMatchingListItem for more details.
   */
  private getSelectedListItem = memoizeOne(findMatchingListItem)

  public constructor(props: IRepositoriesListProps) {
    super(props)

    this.state = {
      newRepositoryMenuExpanded: false,
      selectedItem: null,
      collapsedGroups: new Set<string>(getStringArray(collapsedGroupsKey)),
    }
  }

  private getFolderDepth(repository: Repositoryish): number {
    if (!(repository instanceof Repository) || repository.folderId === null) {
      return 0
    }
    const folder = this.props.repositoryFolders.find(
      f => f.id === repository.folderId
    )
    if (!folder) {
      return 0
    }
    // Depth of the folder itself + 1 (repos indent one level deeper than their folder header)
    let depth = 1
    let current = folder
    while (current.parentId !== null) {
      depth++
      const parent = this.props.repositoryFolders.find(
        f => f.id === current.parentId
      )
      if (!parent) {
        break
      }
      current = parent
    }
    return depth
  }

  private renderItem = (item: IRepositoryListItem, matches: IMatches) => {
    const repository = item.repository
    return (
      <RepositoryListItem
        key={repository.id}
        repository={repository}
        needsDisambiguation={item.needsDisambiguation}
        matches={matches}
        aheadBehind={item.aheadBehind}
        changedFilesCount={item.changedFilesCount}
        isFavorite={
          repository instanceof Repository ? repository.isFavorite : false
        }
        folderDepth={this.getFolderDepth(repository)}
      />
    )
  }

  private getAheadBehindTooltip = (aheadBehind: IAheadBehind | null) => {
    if (aheadBehind === null) {
      return null
    }

    const { ahead, behind } = aheadBehind

    if (behind === 0 && ahead === 0) {
      return null
    }

    return (
      'The currently checked out branch is' +
      (behind ? ` ${commitGrammar(behind)} behind ` : '') +
      (behind && ahead ? 'and' : '') +
      (ahead ? ` ${commitGrammar(ahead)} ahead of ` : '') +
      'its tracked branch.'
    )
  }

  private renderRowFocusTooltip = (
    item: IRepositoryListItem
  ): JSX.Element | string | null => {
    const { repository, aheadBehind, changedFilesCount } = item
    const gitHubRepo =
      repository instanceof Repository ? repository.gitHubRepository : null
    const alias = repository instanceof Repository ? repository.alias : null
    const realName = gitHubRepo ? gitHubRepo.fullName : repository.name
    const aheadBehindTooltip = this.getAheadBehindTooltip(aheadBehind)
    const hasChanges = changedFilesCount > 0
    const uncommittedChangesTooltip = hasChanges
      ? `There are uncommitted changes in this repository.`
      : null

    const ahead = aheadBehind?.ahead ?? 0
    const behind = aheadBehind?.behind ?? 0

    return (
      <div className="repository-list-item-tooltip list-item-tooltip">
        <div>
          <div className="label">Full Name: </div>
          {realName}
          {alias && <> ({alias})</>}
        </div>
        <div>
          <div className="label">Path: </div>
          {repository.path}
        </div>
        {aheadBehindTooltip && (
          <div>
            <div className="label">
              <div className="ahead-behind">
                {ahead > 0 && <Octicon symbol={octicons.arrowUp} />}
                {behind > 0 && <Octicon symbol={octicons.arrowDown} />}
              </div>
            </div>
            {aheadBehindTooltip}
          </div>
        )}
        {uncommittedChangesTooltip && (
          <div>
            <div className="label">
              <span className="change-indicator-wrapper">
                <Octicon symbol={octicons.dotFill} />
              </span>
            </div>
            {uncommittedChangesTooltip}
          </div>
        )}
      </div>
    )
  }

  private getGroupLabel(group: RepositoryListGroup) {
    const { kind } = group
    if (kind === 'favorites') {
      return 'Favorites'
    } else if (kind === 'folder') {
      return group.folderName
    } else if (kind === 'enterprise') {
      return group.host
    } else if (kind === 'other') {
      return 'Other'
    } else if (kind === 'dotcom') {
      return group.owner.login
    } else {
      assertNever(kind, `Unknown repository group kind ${kind}`)
    }
  }

  private isCollapsibleGroup(group: RepositoryListGroup): boolean {
    if (group.kind === 'favorites') {
      return true
    }
    if (group.kind === 'folder' && !group.reposOnly) {
      return true
    }
    return false
  }

  private isGroupCollapsed = (group: RepositoryListGroup): boolean => {
    // reposOnly groups collapse when their parent folder is collapsed
    if (group.kind === 'folder' && group.reposOnly) {
      const parentKey = `1:folder:${group.folderPath}`
      if (this.state.collapsedGroups.has(parentKey)) {
        return true
      }
    }

    if (this.state.collapsedGroups.has(getGroupKey(group))) {
      return true
    }

    // Cascade: if any ancestor folder is collapsed, this group is too
    if (group.kind === 'folder') {
      const folderPath = group.folderPath
      for (const key of this.state.collapsedGroups) {
        if (
          key.startsWith('1:folder:') &&
          folderPath.startsWith(key.slice('1:folder:'.length) + ' / ')
        ) {
          return true
        }
      }
    }

    return false
  }

  private onToggleGroupCollapse = (group: RepositoryListGroup) => {
    const key = getGroupKey(group)
    const collapsedGroups = new Set(this.state.collapsedGroups)
    if (collapsedGroups.has(key)) {
      collapsedGroups.delete(key)
    } else {
      collapsedGroups.add(key)
    }
    setStringArray(collapsedGroupsKey, [...collapsedGroups])
    this.setState({ collapsedGroups })
  }

  private onFolderHeaderContextMenu = (
    group: RepositoryListGroup,
    event: React.MouseEvent
  ) => {
    if (group.kind !== 'folder') {
      return
    }
    event.preventDefault()
    event.stopPropagation()

    const items: IMenuItem[] = [
      {
        label: __DARWIN__ ? 'Create Subfolder…' : 'Create subfolder…',
        action: () => {
          this.props.dispatcher.showPopup({
            type: PopupType.CreateRepositoryFolder,
            parentId: group.folderId,
          })
        },
      },
      {
        label: __DARWIN__ ? 'Rename Folder…' : 'Rename folder…',
        action: () => {
          this.props.dispatcher.showPopup({
            type: PopupType.RenameRepositoryFolder,
            folderId: group.folderId,
            currentName: group.folderName,
          })
        },
      },
      {
        label: __DARWIN__ ? 'Move To' : 'Move to',
        submenu: this.buildMoveFolderSubmenu(group.folderId),
      },
      { type: 'separator' },
      {
        label: __DARWIN__ ? 'Delete Folder' : 'Delete folder',
        action: () => {
          this.props.dispatcher.deleteFolder(group.folderId)
        },
      },
    ]

    showContextualMenu(items)
  }

  /**
   * Builds the list of folders a folder can be moved into.
   *
   * A folder can't be moved into itself or into anything nested beneath it -
   * that would detach the whole branch from the root and leave it unreachable in
   * the sidebar - so both are left out rather than offered and then rejected.
   */
  private buildMoveFolderSubmenu(folderId: number): ReadonlyArray<IMenuItem> {
    const { repositoryFolders } = this.props

    const descendantIds = new Set<number>()
    const collectDescendants = (parentId: number) => {
      for (const folder of repositoryFolders) {
        if (folder.parentId === parentId && !descendantIds.has(folder.id)) {
          descendantIds.add(folder.id)
          collectDescendants(folder.id)
        }
      }
    }
    collectDescendants(folderId)

    const current = repositoryFolders.find(f => f.id === folderId)

    // Shows each candidate as its full path, so two folders that share a name
    // under different parents are still distinguishable.
    const pathOf = (folder: IRepositoryFolder): string => {
      const segments = [folder.name]
      let parentId = folder.parentId

      while (parentId !== null) {
        const parent: IRepositoryFolder | undefined = repositoryFolders.find(
          f => f.id === parentId
        )

        if (parent === undefined) {
          break
        }

        segments.unshift(parent.name)
        parentId = parent.parentId
      }

      return segments.join(' / ')
    }

    const targets = repositoryFolders
      .filter(f => f.id !== folderId && !descendantIds.has(f.id))
      .map(f => ({ folder: f, path: pathOf(f) }))
      .sort((a, b) => a.path.localeCompare(b.path))

    const items: IMenuItem[] = [
      {
        label: __DARWIN__ ? 'Top Level' : 'Top level',
        enabled: current !== undefined && current.parentId !== null,
        action: () => this.moveFolder(folderId, null),
      },
    ]

    if (targets.length > 0) {
      items.push({ type: 'separator' })

      for (const { folder, path } of targets) {
        items.push({
          label: path,
          // Already its parent - offering it would be a no-op.
          enabled: current?.parentId !== folder.id,
          action: () => this.moveFolder(folderId, folder.id),
        })
      }
    }

    return items
  }

  private moveFolder = (folderId: number, newParentId: number | null) => {
    // moveFolder rejects name clashes and cycles; surface those to the user
    // rather than leaving an unhandled rejection.
    this.props.dispatcher
      .moveFolder(folderId, newParentId)
      .catch(e => this.props.dispatcher.postError(e))
  }

  private shouldRenderGroupHeader = (group: RepositoryListGroup): boolean => {
    if (group.kind === 'folder' && group.reposOnly) {
      return false
    }
    // Hide subfolder headers when any ancestor is collapsed
    if (group.kind === 'folder' && group.depth > 0) {
      const folderPath = group.folderPath
      for (const key of this.state.collapsedGroups) {
        if (
          key.startsWith('1:folder:') &&
          folderPath.startsWith(key.slice('1:folder:'.length) + ' / ')
        ) {
          return false
        }
      }
    }
    return true
  }

  private renderGroupHeader = (group: RepositoryListGroup) => {
    // reposOnly groups have no visible header
    if (group.kind === 'folder' && group.reposOnly) {
      return null
    }

    const label = this.getGroupLabel(group)
    const collapsible = this.isCollapsibleGroup(group)
    const collapsed = this.isGroupCollapsed(group)
    let icon: React.ReactNode = null
    const depth = group.kind === 'folder' ? group.depth : 0

    if (group.kind === 'favorites') {
      icon = (
        <Octicon
          symbol={octicons.starFill}
          className="group-header-icon favorites-icon"
        />
      )
    } else if (group.kind === 'folder') {
      icon = (
        <Octicon
          symbol={octicons.fileDirectoryFill}
          className="group-header-icon folder-icon"
        />
      )
    }

    if (collapsible) {
      const style = depth > 0 ? { paddingLeft: `${depth * 16}px` } : undefined
      return (
        <div
          key={getGroupKey(group)}
          className={classNames('filter-list-group-header', 'collapsible', {
            collapsed,
          })}
          style={style}
          onClick={() => this.onToggleGroupCollapse(group)}
          onContextMenu={e => this.onFolderHeaderContextMenu(group, e)}
        >
          <Octicon
            symbol={octicons.chevronRight}
            className="collapse-chevron"
          />
          {icon}
          {label}
        </div>
      )
    }

    return (
      <TooltippedContent
        key={getGroupKey(group)}
        className="filter-list-group-header"
        tooltip={label}
        onlyWhenOverflowed={true}
        tagName="div"
      >
        {icon}
        {label}
      </TooltippedContent>
    )
  }

  private onItemClick = (item: IRepositoryListItem) => {
    const hasIndicator =
      item.changedFilesCount > 0 ||
      (item.aheadBehind !== null
        ? item.aheadBehind.ahead > 0 || item.aheadBehind.behind > 0
        : false)
    this.props.dispatcher.recordRepoClicked(hasIndicator)
    this.props.onSelectionChanged(item.repository)
  }

  private onItemContextMenu = (
    item: IRepositoryListItem,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    event.preventDefault()

    const items = generateRepositoryListContextMenu({
      onRemoveRepository: this.props.onRemoveRepository,
      onShowRepository: this.props.onShowRepository,
      onOpenInShell: this.props.onOpenInShell,
      onOpenInExternalEditor: this.props.onOpenInExternalEditor,
      askForConfirmationOnRemoveRepository:
        this.props.askForConfirmationOnRemoveRepository,
      externalEditorLabel: this.props.externalEditorLabel,
      onChangeRepositoryAlias: this.onChangeRepositoryAlias,
      onRemoveRepositoryAlias: this.onRemoveRepositoryAlias,
      onViewOnGitHub: this.props.onViewOnGitHub,
      repository: item.repository,
      shellLabel: this.props.shellLabel,
      onToggleFavorite: this.onToggleFavorite,
      onMoveToFolder: this.onMoveToFolder,
      onCreateFolder: this.onCreateFolder,
      folders: this.props.repositoryFolders,
    })

    showContextualMenu(items)
  }

  private getItemAriaLabel = (item: IRepositoryListItem) => item.repository.name
  private getGroupAriaLabelGetter =
    (
      groups: ReadonlyArray<
        IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
      >
    ) =>
    (group: number) =>
      this.getGroupLabel(groups[group].identifier)

  public render() {
    const groups = this.getRepositoryGroups(
      this.props.repositories,
      this.props.localRepositoryStateLookup,
      this.props.repositoryFolders
    )

    // So there's two types of selection at play here. There's the repository
    // selection for the whole app and then there's the keyboard selection in
    // the list itself. If the user has selected a repository using keyboard
    // navigation we want to honor that selection. If the user hasn't selected a
    // repository yet we'll select the repository currently selected in the app.
    const selectedItem =
      this.state.selectedItem ??
      this.getSelectedListItem(groups, this.props.selectedRepository)

    return (
      <div className="repository-list">
        <SectionFilterList<IRepositoryListItem, RepositoryListGroup>
          rowHeight={RowHeight}
          selectedItem={selectedItem}
          filterText={this.props.filterText}
          onFilterTextChanged={this.props.onFilterTextChanged}
          renderItem={this.renderItem}
          renderRowFocusTooltip={this.renderRowFocusTooltip}
          renderGroupHeader={this.renderGroupHeader}
          shouldRenderGroupHeader={this.shouldRenderGroupHeader}
          onItemClick={this.onItemClick}
          renderPostFilter={this.renderPostFilter}
          renderNoItems={this.renderNoItems}
          groups={groups}
          isGroupCollapsed={this.isGroupCollapsed}
          invalidationProps={{
            repositories: this.props.repositories,
            filterText: this.props.filterText,
            collapsedGroups: this.state.collapsedGroups,
          }}
          onItemContextMenu={this.onItemContextMenu}
          getGroupAriaLabel={this.getGroupAriaLabelGetter(groups)}
          getItemAriaLabel={this.getItemAriaLabel}
          onSelectionChanged={this.onSelectionChanged}
        />
      </div>
    )
  }

  private onSelectionChanged = (selectedItem: IRepositoryListItem | null) => {
    this.setState({ selectedItem })
  }

  private renderPostFilter = () => {
    return (
      <Button
        className="new-repository-button"
        onClick={this.onNewRepositoryButtonClick}
        ariaExpanded={this.state.newRepositoryMenuExpanded}
        onKeyDown={this.onNewRepositoryButtonKeyDown}
      >
        Add
        <Octicon symbol={octicons.triangleDown} />
      </Button>
    )
  }

  private onNewRepositoryButtonKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    if (event.key === 'ArrowDown') {
      this.onNewRepositoryButtonClick()
    }
  }

  private renderNoItems = () => {
    return (
      <div className="no-items no-results-found">
        <img src={BlankSlateImage} className="blankslate-image" alt="" />
        <div className="title">Sorry, I can't find that repository</div>

        <div className="protip">
          ProTip! Press{' '}
          <div className="kbd-shortcut">
            <KeyboardShortcut darwinKeys={['⌘', 'O']} keys={['Ctrl', 'O']} />
          </div>{' '}
          to quickly add a local repository, and{' '}
          <div className="kbd-shortcut">
            <KeyboardShortcut
              darwinKeys={['⇧', '⌘', 'O']}
              keys={['Ctrl', 'Shift', 'O']}
            />
          </div>{' '}
          to clone from anywhere within the app
        </div>
      </div>
    )
  }

  private onNewRepositoryButtonClick = () => {
    const items: IMenuItem[] = [
      {
        label: __DARWIN__ ? 'Clone Repository…' : 'Clone repository…',
        action: this.onCloneRepository,
      },
      {
        label: __DARWIN__ ? 'Create New Repository…' : 'Create new repository…',
        action: this.onCreateNewRepository,
      },
      {
        label: __DARWIN__
          ? 'Add Existing Repository…'
          : 'Add existing repository…',
        action: this.onAddExistingRepository,
      },
    ]

    this.setState({ newRepositoryMenuExpanded: true })
    showContextualMenu(items).then(() => {
      this.setState({ newRepositoryMenuExpanded: false })
    })
  }

  private onCloneRepository = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.CloneRepository,
      initialURL: null,
    })
  }

  private onAddExistingRepository = () => {
    this.props.dispatcher.showPopup({ type: PopupType.AddRepository })
  }

  private onCreateNewRepository = () => {
    this.props.dispatcher.showPopup({ type: PopupType.CreateRepository })
  }

  private onChangeRepositoryAlias = (repository: Repository) => {
    this.props.dispatcher.showPopup({
      type: PopupType.ChangeRepositoryAlias,
      repository,
    })
  }

  private onRemoveRepositoryAlias = (repository: Repository) => {
    this.props.dispatcher.changeRepositoryAlias(repository, null)
  }

  private onToggleFavorite = (repository: Repository) => {
    this.props.dispatcher.toggleRepositoryFavorite(repository)
  }

  private onMoveToFolder = (
    repository: Repository,
    folderId: number | null
  ) => {
    this.props.dispatcher.setRepositoryFolder(repository, folderId)
  }

  private onCreateFolder = (parentId?: number | null) => {
    this.props.dispatcher.showPopup({
      type: PopupType.CreateRepositoryFolder,
      parentId: parentId ?? null,
    })
  }
}
