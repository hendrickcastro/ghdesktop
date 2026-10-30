import { Repository } from '../../models/repository'
import { IFilterListGroup } from '../lib/filter-list'
import { getText } from '../lib/section-filter-list'
import { match } from '../../lib/fuzzy-find'
import { IRepositoryListItem, RepositoryListGroup } from './group-repositories'

/**
 * Whether a list item can be part of a multi-selection. Linked worktrees
 * can't: they're listed under their parent whatever folder they're in, so
 * moving one would change nothing visible.
 */
export const isMultiSelectable = (item: IRepositoryListItem) =>
  item.repository instanceof Repository && item.worktreeParent === null

/**
 * The ids of the selectable repositories in the order the list shows them,
 * each once (a favorite is listed twice). Mirrors what the list renders:
 * collapsed groups are left out and, while filtering, only matches count.
 */
export function getListedRepositoryIds(
  groups: ReadonlyArray<
    IFilterListGroup<IRepositoryListItem, RepositoryListGroup>
  >,
  isGroupCollapsed: (group: RepositoryListGroup) => boolean,
  filterText: string
): ReadonlyArray<number> {
  const filter = filterText.toLowerCase()
  const ids: number[] = []
  const seen = new Set<number>()

  for (const group of groups) {
    if (isGroupCollapsed(group.identifier)) {
      continue
    }

    const items = filter
      ? match(filter, group.items, getText).map(m => m.item)
      : group.items

    for (const item of items) {
      const { id } = item.repository
      if (isMultiSelectable(item) && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
  }

  return ids
}

/** Adds the id to the selection, or takes it out if it was already in it. */
export function toggleInSelection(
  selection: ReadonlySet<number>,
  id: number
): ReadonlySet<number> {
  const next = new Set(selection)
  if (!next.delete(id)) {
    next.add(id)
  }
  return next
}

/**
 * The ids from the anchor to the target, both included, in listed order. Just
 * the target when the anchor isn't listed (filtered out or collapsed).
 */
export function getRange(
  listedIds: ReadonlyArray<number>,
  anchor: number,
  target: number
): ReadonlySet<number> {
  const from = listedIds.indexOf(anchor)
  const to = listedIds.indexOf(target)

  if (from === -1 || to === -1) {
    return new Set([target])
  }

  const [start, end] = from <= to ? [from, to] : [to, from]
  return new Set(listedIds.slice(start, end + 1))
}
