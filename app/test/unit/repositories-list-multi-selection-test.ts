import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  getListedRepositoryIds,
  getRange,
  toggleInSelection,
} from '../../src/ui/repositories-list/multi-selection'
import {
  groupRepositories,
  getGroupKey,
} from '../../src/ui/repositories-list/group-repositories'
import { Repository, ILocalRepositoryState } from '../../src/models/repository'
import { CloningRepository } from '../../src/models/cloning-repository'

describe('repository list multi-selection', () => {
  const cache = new Map<number, ILocalRepositoryState>()

  const repo = (
    path: string,
    id: number,
    options: {
      favorite?: boolean
      folderId?: number | null
      mainWorktreePath?: string
    } = {}
  ) =>
    new Repository(
      path,
      id,
      null,
      false,
      null,
      undefined,
      false,
      undefined,
      options.mainWorktreePath ?? path,
      options.favorite ?? false,
      options.folderId ?? null
    )

  const folders = [{ id: 10, name: 'Work', parentId: null }]
  const notCollapsed = () => false

  it('lists each selectable repository once, in display order', () => {
    const groups = groupRepositories(
      [
        repo('/repos/zeta', 1, { favorite: true }),
        repo('/repos/alpha', 2, { folderId: 10 }),
        repo('/repos/beta', 3),
        // A linked worktree of beta can't be multi-selected
        repo('/wt/beta/fix', 4, { mainWorktreePath: '/repos/beta' }),
        new CloningRepository('/repos/cloning', 'https://example.com/x.git'),
      ],
      cache,
      folders
    )

    // Favorites first, then the Work folder, then the rest; zeta (a favorite)
    // is listed twice but counted once.
    assert.deepEqual(
      getListedRepositoryIds(groups, notCollapsed, ''),
      [1, 2, 3]
    )
  })

  it('leaves out collapsed groups and repositories the filter hides', () => {
    const groups = groupRepositories(
      [
        repo('/repos/alpha', 1, { folderId: 10 }),
        repo('/repos/beta', 2),
        repo('/repos/gamma', 3),
      ],
      cache,
      folders
    )

    const workKey = getGroupKey(groups[0].identifier)
    const collapsed = (g: typeof groups[0]['identifier']) =>
      getGroupKey(g) === workKey

    assert.deepEqual(getListedRepositoryIds(groups, collapsed, ''), [2, 3])
    assert.deepEqual(getListedRepositoryIds(groups, notCollapsed, 'gam'), [3])
  })

  it('selects a range in either direction', () => {
    const listed = [5, 6, 7, 8]

    assert.deepEqual([...getRange(listed, 6, 8)], [6, 7, 8])
    assert.deepEqual([...getRange(listed, 8, 6)], [6, 7, 8])
    assert.deepEqual([...getRange(listed, 7, 7)], [7])
    // An anchor that's no longer listed selects just the target
    assert.deepEqual([...getRange(listed, 99, 6)], [6])
  })

  it('toggles a repository in and out', () => {
    const once = toggleInSelection(new Set([1]), 2)
    assert.deepEqual([...once].sort(), [1, 2])
    assert.deepEqual([...toggleInSelection(once, 1)], [2])
  })
})
