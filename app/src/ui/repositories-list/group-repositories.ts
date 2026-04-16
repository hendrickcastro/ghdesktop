import {
  Repository,
  ILocalRepositoryState,
  nameOf,
  isRepositoryWithGitHubRepository,
  RepositoryWithGitHubRepository,
} from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { getHTMLURL } from '../../lib/api'
import { caseInsensitiveCompare, compare } from '../../lib/compare'
import { IFilterListGroup, IFilterListItem } from '../lib/filter-list'
import { IAheadBehind } from '../../models/branch'
import { assertNever } from '../../lib/fatal-error'
import { isDotCom } from '../../lib/endpoint-capabilities'
import { Owner } from '../../models/owner'
import { IRepositoryFolder } from '../../models/repository-folder'

export type RepositoryListGroup =
  | {
      kind: 'favorites'
    }
  | {
      kind: 'folder'
      folderId: number
      folderName: string
      /** Full display path e.g. "Work / Frontend" */
      folderPath: string
      /** Nesting depth (0 = root folder, 1 = subfolder, etc.) */
      depth: number
      /**
       * When true this group contains only the direct repos of a parent folder
       * (no header). Used so that repos appear after subfolders in the list.
       */
      reposOnly?: boolean
    }
  | {
      kind: 'other'
    }
  | {
      kind: 'dotcom'
      owner: Owner
    }
  | {
      kind: 'enterprise'
      host: string
    }

/**
 * Returns a unique grouping key (string) for a repository group. Doubles as a
 * case sensitive sorting key (i.e the case sensitive sort order of the keys is
 * the order in which the groups will be displayed in the repository list).
 */
export const getGroupKey = (group: RepositoryListGroup) => {
  const { kind } = group
  switch (kind) {
    case 'favorites':
      return `0:favorites`
    case 'folder':
      // reposOnly groups use /~ suffix so they sort AFTER all subfolders
      return group.reposOnly
        ? `1:folder:${group.folderPath}/~`
        : `1:folder:${group.folderPath}`
    case 'dotcom':
      return `3:dotcom:${group.owner.login}`
    case 'enterprise':
      return `4:enterprise:${group.host}`
    case 'other':
      return `5:other`
    default:
      assertNever(group, `Unknown repository group kind ${kind}`)
  }
}
export type Repositoryish = Repository | CloningRepository

export interface IRepositoryListItem extends IFilterListItem {
  readonly text: ReadonlyArray<string>
  readonly id: string
  readonly repository: Repositoryish
  readonly needsDisambiguation: boolean
  readonly aheadBehind: IAheadBehind | null
  readonly changedFilesCount: number
}

const getHostForRepository = (repo: RepositoryWithGitHubRepository) =>
  new URL(getHTMLURL(repo.gitHubRepository.endpoint)).host

const getGroupForRepository = (repo: Repositoryish): RepositoryListGroup => {
  if (repo instanceof Repository && isRepositoryWithGitHubRepository(repo)) {
    return isDotCom(repo.gitHubRepository.endpoint)
      ? { kind: 'dotcom', owner: repo.gitHubRepository.owner }
      : { kind: 'enterprise', host: getHostForRepository(repo) }
  }
  return { kind: 'other' }
}

type RepoGroupItem = { group: RepositoryListGroup; repos: Repositoryish[] }

/** Build the full display path for a folder, e.g. "Work / Frontend" */
function buildFolderPath(
  folderId: number,
  folderMap: ReadonlyMap<number, IRepositoryFolder>
): string {
  const parts: string[] = []
  let current = folderMap.get(folderId)
  while (current) {
    parts.unshift(current.name)
    current =
      current.parentId !== null ? folderMap.get(current.parentId) : undefined
  }
  return parts.join(' / ')
}

/** Compute the depth of a folder (0 = root, 1 = subfolder, etc.) */
function getFolderDepth(
  folderId: number,
  folderMap: ReadonlyMap<number, IRepositoryFolder>
): number {
  let depth = 0
  let current = folderMap.get(folderId)
  while (current && current.parentId !== null) {
    depth++
    current = folderMap.get(current.parentId)
  }
  return depth
}

export function groupRepositories(
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  folders: ReadonlyArray<IRepositoryFolder> = []
): ReadonlyArray<IFilterListGroup<IRepositoryListItem, RepositoryListGroup>> {
  const folderMap = new Map<number, IRepositoryFolder>()
  for (const folder of folders) {
    folderMap.set(folder.id, folder)
  }
  const groups = new Map<string, RepoGroupItem>()

  const addToGroup = (group: RepositoryListGroup, repo: Repositoryish) => {
    const key = getGroupKey(group)
    let rg = groups.get(key)
    if (!rg) {
      rg = { group, repos: [] }
      groups.set(key, rg)
    }

    rg.repos.push(repo)
  }

  for (const repo of repositories) {
    // Favorites: add to favorites group AND their normal group
    if (repo instanceof Repository && repo.isFavorite) {
      addToGroup({ kind: 'favorites' }, repo)
    }

    // Folder: repos in a folder go ONLY into the folder group, not their normal group
    if (repo instanceof Repository && repo.folderId !== null) {
      const folder = folderMap.get(repo.folderId)
      if (folder) {
        addToGroup(
          {
            kind: 'folder',
            folderId: folder.id,
            folderName: folder.name,
            folderPath: buildFolderPath(folder.id, folderMap),
            depth: getFolderDepth(folder.id, folderMap),
          },
          repo
        )
        continue // skip adding to normal group
      }
    }

    addToGroup(getGroupForRepository(repo), repo)
  }

  // Ensure ALL folders appear as groups even if they have no repos yet.
  for (const folder of folders) {
    const folderGroup: RepositoryListGroup = {
      kind: 'folder',
      folderId: folder.id,
      folderName: folder.name,
      folderPath: buildFolderPath(folder.id, folderMap),
      depth: getFolderDepth(folder.id, folderMap),
    }
    const key = getGroupKey(folderGroup)
    if (!groups.has(key)) {
      groups.set(key, { group: folderGroup, repos: [] })
    }
  }

  // For folders that have subfolders: move their direct repos to a separate
  // "reposOnly" group that sorts after all subfolders, so the visual order is:
  //   📁 Parent (header)
  //     📁 ChildA (subfolder)
  //     📁 ChildB (subfolder)
  //     repo-1   (parent's direct repos)
  //     repo-2
  const folderIdsWithChildren = new Set<number>()
  for (const folder of folders) {
    if (folder.parentId !== null) {
      folderIdsWithChildren.add(folder.parentId)
    }
  }

  for (const [, rg] of groups) {
    if (
      rg.group.kind === 'folder' &&
      !rg.group.reposOnly &&
      folderIdsWithChildren.has(rg.group.folderId) &&
      rg.repos.length > 0
    ) {
      // Create a headerless repos-only group for the direct repos
      const reposGroup: RepositoryListGroup = {
        ...rg.group,
        reposOnly: true,
      }
      const reposKey = getGroupKey(reposGroup)
      groups.set(reposKey, { group: reposGroup, repos: [...rg.repos] })
      // Clear repos from the header group
      rg.repos = []
    }
  }

  return Array.from(groups)
    .sort(([xKey], [yKey]) => compare(xKey, yKey))
    .map(([, { group, repos }]) => ({
      identifier: group,
      items: toSortedListItems(
        group,
        repos,
        localRepositoryStateLookup,
        groups
      ),
    }))
}

// Returns the display title for a repository, which is either the alias
// (if available) or the name.
const getDisplayTitle = (r: Repositoryish) =>
  r instanceof Repository && r.alias != null ? r.alias : r.name

const toSortedListItems = (
  group: RepositoryListGroup,
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  groups: Map<string, RepoGroupItem>
): IRepositoryListItem[] => {
  const groupNames = new Map<string, number>()
  const allNames = new Map<string, number>()

  for (const groupItem of groups.values()) {
    // Items in favorites and folder groups may be present in another
    // group so we don't want to count them for disambiguation.
    if (
      groupItem.group.kind === 'favorites' ||
      groupItem.group.kind === 'folder'
    ) {
      continue
    }

    for (const title of groupItem.repos.map(getDisplayTitle)) {
      allNames.set(title, (allNames.get(title) ?? 0) + 1)
      if (groupItem.group === group) {
        groupNames.set(title, (groupNames.get(title) ?? 0) + 1)
      }
    }
  }

  return repositories
    .map(r => {
      const repoState = localRepositoryStateLookup.get(r.id)
      const title = getDisplayTitle(r)

      return {
        text: r instanceof Repository ? [title, nameOf(r)] : [title],
        id: r.id.toString(),
        repository: r,
        needsDisambiguation:
          ((groupNames.get(title) ?? 0) > 1 && group.kind === 'enterprise') ||
          ((allNames.get(title) ?? 0) > 1 &&
            (group.kind === 'favorites' ||
              group.kind === 'folder')),
        aheadBehind: repoState?.aheadBehind ?? null,
        changedFilesCount: repoState?.changedFilesCount ?? 0,
      }
    })
    .sort(({ repository: x }, { repository: y }) =>
      caseInsensitiveCompare(getDisplayTitle(x), getDisplayTitle(y))
    )
}
