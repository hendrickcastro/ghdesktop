import * as React from 'react'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { IRepositoryFolder } from '../../models/repository-folder'
import {
  BulkPullOutcome,
  formatBulkPullSummary,
  summarizeBulkPull,
} from '../../models/bulk-pull'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { TextBox } from '../lib/text-box'
import { Octicon, syncClockwise } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { getNumberArray, setNumberArray } from '../../lib/local-storage'
import { TooltippedContent } from '../lib/tooltipped-content'

interface IPullRepositoriesProps {
  readonly dispatcher: Dispatcher
  readonly repositories: ReadonlyArray<Repository | CloningRepository>
  readonly repositoryFolders: ReadonlyArray<IRepositoryFolder>
  readonly onDismissed: () => void
}

/** Where a repository is in the batch: waiting, pulling, or done. */
type RowStatus = 'queued' | 'running' | BulkPullOutcome

interface IPullRepositoriesState {
  readonly selected: ReadonlySet<number>
  readonly filterText: string
  readonly running: boolean
  /** Whether a batch has finished since the dialog opened. */
  readonly finished: boolean
  readonly statuses: ReadonlyMap<number, RowStatus>
}

/** A repository as shown in the list, with its display strings precomputed. */
interface IRow {
  readonly repository: Repository
  readonly name: string
  /** The folder path or the GitHub owner, whichever says more. */
  readonly detail: string
  readonly searchText: string
}

/** The ids of the repositories pulled last time, so a batch can be repeated. */
const LastSelectionKey = 'pull-repositories-last-selection'

/**
 * Pulls run this many at a time. Sequential would be safe but slow across
 * dozens of repositories; more than this and a metered connection or a rate
 * limited host starts returning errors that have nothing to do with the code.
 */
const Concurrency = 3

/**
 * A dialog for pulling several repositories in one go: pick them, pull, and
 * see how each one went without an error dialog per repository.
 */
export class PullRepositories extends React.Component<
  IPullRepositoriesProps,
  IPullRepositoriesState
> {
  private unmounted = false

  public constructor(props: IPullRepositoriesProps) {
    super(props)

    const rows = this.getRows()
    const ids = new Set(rows.map(r => r.repository.id))

    // Repeat the last batch when there was one, otherwise start with everything
    // checked: the common case is "pull all of them".
    const remembered = getNumberArray(LastSelectionKey).filter(id =>
      ids.has(id)
    )

    this.state = {
      selected: new Set(remembered.length > 0 ? remembered : ids),
      filterText: '',
      running: false,
      finished: false,
      statuses: new Map(),
    }
  }

  public componentWillUnmount() {
    this.unmounted = true
  }

  /** Every pullable repository, sorted by folder then name. */
  private getRows(): ReadonlyArray<IRow> {
    const folderPath = this.getFolderPathResolver()

    return this.props.repositories
      .filter((r): r is Repository => r instanceof Repository)
      .map(repository => {
        const name = repository.alias ?? repository.name
        const folder = folderPath(repository.folderId)
        const owner = repository.gitHubRepository?.owner.login ?? ''
        const detail = folder !== '' ? folder : owner

        return {
          repository,
          name,
          detail,
          searchText: `${name} ${detail} ${repository.name}`.toLowerCase(),
        }
      })
      .sort(
        (a, b) =>
          a.detail.localeCompare(b.detail, undefined, { sensitivity: 'base' }) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      )
  }

  /** Turns a folder id into "Parent / Child", or '' for repositories at the root. */
  private getFolderPathResolver() {
    const byId = new Map(this.props.repositoryFolders.map(f => [f.id, f]))

    return (folderId: number | null): string => {
      const names: string[] = []
      let current = folderId === null ? undefined : byId.get(folderId)

      // Guard against a cycle in stored folders; it would hang the dialog.
      while (current !== undefined && names.length < 32) {
        names.unshift(current.name)
        current =
          current.parentId === null ? undefined : byId.get(current.parentId)
      }

      return names.join(' / ')
    }
  }

  private getVisibleRows(rows: ReadonlyArray<IRow>): ReadonlyArray<IRow> {
    const needle = this.state.filterText.trim().toLowerCase()
    return needle === ''
      ? rows
      : rows.filter(r => r.searchText.includes(needle))
  }

  private onFilterTextChanged = (filterText: string) =>
    this.setState({ filterText })

  private onToggleRow = (id: number) => () => {
    if (this.state.running) {
      return
    }

    this.setState(prev => {
      const selected = new Set(prev.selected)
      if (selected.has(id)) {
        selected.delete(id)
      } else {
        selected.add(id)
      }
      return { selected }
    })
  }

  /**
   * Checks or clears every repository the filter is showing. Acting on the
   * visible rows rather than all of them is what makes "filter to a folder,
   * select all" work.
   */
  private onToggleAll = (event: React.FormEvent<HTMLInputElement>) => {
    if (this.state.running) {
      return
    }

    const check = event.currentTarget.checked
    const visible = this.getVisibleRows(this.getRows()).map(
      r => r.repository.id
    )

    this.setState(prev => {
      const selected = new Set(prev.selected)
      for (const id of visible) {
        if (check) {
          selected.add(id)
        } else {
          selected.delete(id)
        }
      }
      return { selected }
    })
  }

  private onPull = async () => {
    if (this.state.running) {
      return
    }

    const rows = this.getRows().filter(r =>
      this.state.selected.has(r.repository.id)
    )

    if (rows.length === 0) {
      return
    }

    setNumberArray(
      LastSelectionKey,
      rows.map(r => r.repository.id)
    )

    this.setState({
      running: true,
      finished: false,
      statuses: new Map(rows.map(r => [r.repository.id, 'queued' as const])),
    })

    const queue = [...rows]

    const worker = async () => {
      for (let row = queue.shift(); row !== undefined; row = queue.shift()) {
        const { repository } = row
        this.setStatus(repository.id, 'running')
        const outcome = await this.props.dispatcher.pullRepositoryQuietly(
          repository
        )
        this.setStatus(repository.id, outcome)
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(Concurrency, queue.length) }, worker)
    )

    if (!this.unmounted) {
      this.setState({ running: false, finished: true })
    }
  }

  private setStatus(id: number, status: RowStatus) {
    if (this.unmounted) {
      return
    }

    this.setState(prev => {
      const statuses = new Map(prev.statuses)
      statuses.set(id, status)
      return { statuses }
    })
  }

  public render() {
    const rows = this.getRows()
    const visible = this.getVisibleRows(rows)
    const { selected, running, finished } = this.state

    const selectedCount = rows.filter(r => selected.has(r.repository.id)).length
    const selectedVisible = visible.filter(r =>
      selected.has(r.repository.id)
    ).length

    const allValue =
      visible.length > 0 && selectedVisible === visible.length
        ? CheckboxValue.On
        : selectedVisible === 0
        ? CheckboxValue.Off
        : CheckboxValue.Mixed

    const okButtonText = running
      ? 'Pulling…'
      : finished
      ? 'Pull Again'
      : selectedCount === 1
      ? 'Pull 1 Repository'
      : `Pull ${selectedCount} Repositories`

    return (
      <Dialog
        id="pull-repositories"
        title={
          __DARWIN__ ? 'Pull Multiple Repositories' : 'Pull multiple repositories'
        }
        onSubmit={this.onPull}
        onDismissed={this.props.onDismissed}
        dismissDisabled={running}
        loading={running}
      >
        <DialogContent>
          <div className="pull-repositories-toolbar">
            <Checkbox
              value={allValue}
              onChange={this.onToggleAll}
              disabled={running || visible.length === 0}
              label={
                visible.length === rows.length
                  ? `Select all (${selectedCount} of ${rows.length})`
                  : `Select all shown (${selectedVisible} of ${visible.length})`
              }
            />
            <TextBox
              type="search"
              placeholder="Filter repositories"
              value={this.state.filterText}
              onValueChanged={this.onFilterTextChanged}
            />
          </div>

          <div className="pull-repositories-list" role="list">
            {visible.length === 0 ? (
              <div className="pull-repositories-empty">
                {rows.length === 0
                  ? 'There are no repositories to pull.'
                  : `No repositories match "${this.state.filterText}".`}
              </div>
            ) : (
              visible.map(this.renderRow)
            )}
          </div>

          {this.renderSummary()}
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={okButtonText}
            okButtonDisabled={running || selectedCount === 0}
            cancelButtonText={finished ? 'Close' : 'Cancel'}
            cancelButtonDisabled={running}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private renderRow = (row: IRow) => {
    const { repository, name, detail } = row
    const checked = this.state.selected.has(repository.id)
    const status = this.state.statuses.get(repository.id)

    return (
      <div className="pull-repositories-row" role="listitem" key={repository.id}>
        <Checkbox
          value={checked ? CheckboxValue.On : CheckboxValue.Off}
          onChange={this.onToggleRow(repository.id)}
          disabled={this.state.running}
          label={
            <span className="repo-label">
              <span className="repo-name">{name}</span>
              {detail !== '' && <span className="repo-detail">{detail}</span>}
            </span>
          }
        />
        {status !== undefined && this.renderStatus(status)}
      </div>
    )
  }

  private renderStatus(status: RowStatus) {
    if (status === 'queued') {
      return <div className="status queued">Waiting…</div>
    }

    if (status === 'running') {
      return (
        <div className="status running">
          <Octicon symbol={syncClockwise} className="spin" />
          <span>Pulling…</span>
        </div>
      )
    }

    switch (status.kind) {
      case 'updated':
        return (
          <div className="status updated">
            <Octicon symbol={octicons.check} />
            <span>Updated</span>
          </div>
        )
      case 'up-to-date':
        return (
          <div className="status up-to-date">
            <Octicon symbol={octicons.check} />
            <span>Already up to date</span>
          </div>
        )
      case 'skipped':
        return (
          <TooltippedContent
            className="status skipped"
            tooltip={status.reason}
            tagName="div"
          >
            <Octicon symbol={octicons.circleSlash} />
            <span>Skipped: {status.reason}</span>
          </TooltippedContent>
        )
      case 'failed':
        return (
          <TooltippedContent
            className="status failed"
            tooltip={status.error}
            tagName="div"
          >
            <Octicon symbol={octicons.alert} />
            <span>Failed: {status.error}</span>
          </TooltippedContent>
        )
    }
  }

  private renderSummary() {
    const { statuses, running, finished } = this.state

    if (statuses.size === 0) {
      return null
    }

    if (running) {
      const done = [...statuses.values()].filter(
        s => s !== 'queued' && s !== 'running'
      ).length

      return (
        <p className="pull-repositories-summary">
          Pulled {done} of {statuses.size}…
        </p>
      )
    }

    if (!finished) {
      return null
    }

    const outcomes = [...statuses.values()].filter(
      (s): s is BulkPullOutcome => s !== 'queued' && s !== 'running'
    )

    return (
      <p className="pull-repositories-summary">
        {formatBulkPullSummary(summarizeBulkPull(outcomes))}
      </p>
    )
  }
}
