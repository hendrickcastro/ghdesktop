import * as React from 'react'
import { Account } from '../../models/account'
import { IFilterListGroup } from '../lib/filter-list'
import { IAPIRepository } from '../../lib/api'
import {
  ICloneableRepositoryListItem,
  groupRepositories,
  YourRepositoriesIdentifier,
} from './group-repositories'
import memoizeOne from 'memoize-one'
import { Button } from '../lib/button'
import { IMatches, match } from '../../lib/fuzzy-find'
import { Octicon, syncClockwise } from '../octicons'
import { HighlightText } from '../lib/highlight-text'
import { ClickSource } from '../lib/list'
import { LinkButton } from '../lib/link-button'
import { Ref } from '../lib/ref'
import { SectionFilterList, getText } from '../lib/section-filter-list'
import { TooltippedContent } from '../lib/tooltipped-content'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { ICloneCandidate, cloneCandidateFromAPIRepository } from './multi-clone'

interface ICloneableRepositoryFilterListProps {
  /** The account to clone from. */
  readonly account: Account

  /**
   * The currently selected repository, or null if no repository
   * is selected.
   */
  readonly selectedItem: IAPIRepository | null

  /** Called when a repository is selected. */
  readonly onSelectionChanged: (selectedItem: IAPIRepository | null) => void

  /**
   * The list of repositories that the account has explicit permissions
   * to access, or null if no repositories has been loaded yet.
   */
  readonly repositories: ReadonlyArray<IAPIRepository> | null

  /**
   * Whether or not the list of repositories is currently being loaded
   * by the API Repositories Store. This determines whether the loading
   * indicator is shown or not.
   */
  readonly loading: boolean

  /**
   * The contents of the filter text box used to filter the list of
   * repositories.
   */
  readonly filterText: string

  /**
   * Called when the filter text is changed by the user entering a new
   * value in the filter text box.
   */
  readonly onFilterTextChanged: (filterText: string) => void

  /**
   * Called when the user requests a refresh of the repositories
   * available for cloning.
   */
  readonly onRefreshRepositories: (account: Account) => void

  /**
   * This function will be called when a pointer device is pressed and then
   * released on a selectable row. Note that this follows the conventions
   * of button elements such that pressing Enter or Space on a keyboard
   * while focused on a particular row will also trigger this event. Consumers
   * can differentiate between the two using the source parameter.
   *
   * Consumers of this event do _not_ have to call event.preventDefault,
   * when this event is subscribed to the list will automatically call it.
   */
  readonly onItemClicked?: (
    repository: IAPIRepository,
    source: ClickSource
  ) => void

  readonly renderPreFilter?: () => JSX.Element | null

  /**
   * Repositories ticked for cloning together, by clone URL. Providing this
   * along with onCheckedChanged adds a checkbox to every row, every owner
   * group, and the filter row.
   */
  readonly checked?: ReadonlyMap<string, ICloneCandidate>

  readonly onCheckedChanged?: (
    candidates: ReadonlyArray<ICloneCandidate>,
    checked: boolean
  ) => void

  /**
   * Ticked repositories whose destination already has something in it, by
   * clone URL, with the reason. Shown as a badge on the row.
   */
  readonly conflicts?: ReadonlyMap<string, string>
}

const RowHeight = 31

/**
 * Iterate over all groups until a list item is found that matches
 * the clone url of the provided repository.
 */
function findMatchingListItem(
  groups: ReadonlyArray<IFilterListGroup<ICloneableRepositoryListItem>>,
  selectedRepository: IAPIRepository | null
) {
  if (selectedRepository !== null) {
    for (const group of groups) {
      for (const item of group.items) {
        if (item.url === selectedRepository.clone_url) {
          return item
        }
      }
    }
  }

  return null
}

/**
 * Attempt to locate the source IAPIRepository instance given
 * an ICloneableRepositoryList item using clone_url for the
 * equality comparison.
 */
function findRepositoryForListItem(
  repositories: ReadonlyArray<IAPIRepository>,
  listItem: ICloneableRepositoryListItem
) {
  return repositories.find(r => r.clone_url === listItem.url) || null
}

/**
 * The items the list is currently showing, per group, using the same matching
 * the list itself uses so "select all shown" and the list can't disagree.
 */
function visibleItemsByGroup(
  groups: ReadonlyArray<IFilterListGroup<ICloneableRepositoryListItem>>,
  filterText: string
): ReadonlyMap<string, ReadonlyArray<ICloneableRepositoryListItem>> {
  const filter = filterText.toLowerCase()
  const visible = new Map<string, ReadonlyArray<ICloneableRepositoryListItem>>()

  for (const group of groups) {
    visible.set(
      group.identifier,
      filter === ''
        ? group.items
        : match(filter, group.items, getText).map(m => m.item)
    )
  }

  return visible
}

export class CloneableRepositoryFilterList extends React.PureComponent<ICloneableRepositoryFilterListProps> {
  /**
   * A memoized function for grouping repositories for display
   * in the FilterList. The group will not be recomputed as long
   * as the provided list of repositories is equal to the last
   * time the method was called (reference equality).
   */
  private getRepositoryGroups = memoizeOne(
    (repositories: ReadonlyArray<IAPIRepository> | null, login: string) =>
      repositories === null ? [] : groupRepositories(repositories, login)
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

  private getVisible = memoizeOne(visibleItemsByGroup)

  public componentDidMount() {
    if (this.props.repositories === null) {
      this.refreshRepositories()
    }
  }

  public componentDidUpdate(prevProps: ICloneableRepositoryFilterListProps) {
    if (
      prevProps.repositories !== this.props.repositories &&
      this.props.repositories === null
    ) {
      this.refreshRepositories()
    }
  }

  private refreshRepositories = () => {
    this.props.onRefreshRepositories(this.props.account)
  }

  private get multiSelect(): boolean {
    return (
      this.props.checked !== undefined &&
      this.props.onCheckedChanged !== undefined
    )
  }

  private getGroupAriaLabelGetter =
    (groups: ReadonlyArray<IFilterListGroup<ICloneableRepositoryListItem>>) =>
    (group: number) => {
      const groupIdentifier = groups[group].identifier
      return groupIdentifier === YourRepositoriesIdentifier
        ? this.getYourRepositoriesLabel()
        : groupIdentifier
    }

  private getGroups() {
    return this.getRepositoryGroups(
      this.props.repositories,
      this.props.account.login
    )
  }

  private getVisibleItems() {
    return this.getVisible(this.getGroups(), this.props.filterText)
  }

  /** The candidates behind a set of list items, in list order. */
  private toCandidates(items: ReadonlyArray<ICloneableRepositoryListItem>) {
    const { repositories } = this.props

    if (repositories === null) {
      return []
    }

    return items
      .map(item => findRepositoryForListItem(repositories, item))
      .filter((r): r is IAPIRepository => r !== null)
      .map(cloneCandidateFromAPIRepository)
  }

  /** On, Off or Mixed depending on how many of the items are ticked. */
  private checkboxValueFor(items: ReadonlyArray<ICloneableRepositoryListItem>) {
    const checked = this.props.checked
    const ticked =
      checked === undefined ? 0 : items.filter(i => checked.has(i.url)).length

    return ticked === 0
      ? CheckboxValue.Off
      : ticked === items.length
      ? CheckboxValue.On
      : CheckboxValue.Mixed
  }

  private onToggleItem =
    (item: ICloneableRepositoryListItem) =>
    (event: React.FormEvent<HTMLInputElement>) => {
      this.props.onCheckedChanged?.(
        this.toCandidates([item]),
        event.currentTarget.checked
      )
    }

  private onToggleGroup =
    (identifier: string) => (event: React.FormEvent<HTMLInputElement>) => {
      const items = this.getVisibleItems().get(identifier) ?? []
      this.props.onCheckedChanged?.(
        this.toCandidates(items),
        event.currentTarget.checked
      )
    }

  private onToggleAllVisible = (event: React.FormEvent<HTMLInputElement>) => {
    const items = [...this.getVisibleItems().values()].flat()
    this.props.onCheckedChanged?.(
      this.toCandidates(items),
      event.currentTarget.checked
    )
  }

  public render() {
    const { repositories, account, selectedItem, checked, conflicts } =
      this.props

    const groups = this.getRepositoryGroups(repositories, account.login)
    const selectedListItem = this.getSelectedListItem(groups, selectedItem)

    return (
      <SectionFilterList<ICloneableRepositoryListItem>
        className={
          this.multiSelect ? 'clone-github-repo multi-select' : 'clone-github-repo'
        }
        rowHeight={RowHeight}
        selectedItem={selectedListItem}
        renderItem={this.renderItem}
        renderGroupHeader={this.renderGroupHeader}
        onSelectionChanged={this.onSelectionChanged}
        invalidationProps={{ groups, checked, conflicts }}
        groups={groups}
        filterText={this.props.filterText}
        onFilterTextChanged={this.props.onFilterTextChanged}
        renderNoItems={this.renderNoItems}
        renderPostFilter={this.renderPostFilter}
        renderPreFilter={this.renderPreFilter}
        onItemClick={this.props.onItemClicked ? this.onItemClick : undefined}
        placeholderText={'Filter your repositories'}
        getGroupAriaLabel={this.getGroupAriaLabelGetter(groups)}
      />
    )
  }

  private renderPreFilter = () => {
    const custom = this.props.renderPreFilter?.() ?? null

    if (!this.multiSelect) {
      return custom
    }

    const items = [...this.getVisibleItems().values()].flat()

    if (items.length === 0) {
      return custom
    }

    const checked = this.props.checked
    const ticked =
      checked === undefined ? 0 : items.filter(i => checked.has(i.url)).length

    return (
      <>
        {custom}
        <Checkbox
          className="multi-clone-select-all"
          value={this.checkboxValueFor(items)}
          onChange={this.onToggleAllVisible}
          label={
            this.props.filterText === ''
              ? `All (${ticked}/${items.length})`
              : `All shown (${ticked}/${items.length})`
          }
        />
      </>
    )
  }

  private onItemClick = (
    item: ICloneableRepositoryListItem,
    source: ClickSource
  ) => {
    const { onItemClicked, repositories } = this.props

    if (onItemClicked === undefined || repositories === null) {
      return
    }

    const selectedItem = findRepositoryForListItem(repositories, item)

    if (selectedItem !== null) {
      onItemClicked(selectedItem, source)
    }
  }

  private onSelectionChanged = (item: ICloneableRepositoryListItem | null) => {
    if (item === null || this.props.repositories === null) {
      this.props.onSelectionChanged(null)
    } else {
      this.props.onSelectionChanged(
        findRepositoryForListItem(this.props.repositories, item)
      )
    }
  }

  private getYourRepositoriesLabel = () => {
    return __DARWIN__ ? 'Your Repositories' : 'Your repositories'
  }

  private renderGroupHeader = (identifier: string) => {
    let header = identifier
    if (identifier === YourRepositoriesIdentifier) {
      header = this.getYourRepositoriesLabel()
    }

    if (!this.multiSelect) {
      return (
        <div className="clone-repository-list-content clone-repository-list-group-header">
          {header}
        </div>
      )
    }

    const items = this.getVisibleItems().get(identifier) ?? []

    return (
      <div className="clone-repository-list-content clone-repository-list-group-header">
        <Checkbox
          value={this.checkboxValueFor(items)}
          onChange={this.onToggleGroup(identifier)}
        />
        <span className="group-name">{header}</span>
      </div>
    )
  }

  private renderItem = (
    item: ICloneableRepositoryListItem,
    matches: IMatches
  ) => {
    const conflict = this.props.conflicts?.get(item.url)

    return (
      <div className="clone-repository-list-item">
        {this.multiSelect && (
          <Checkbox
            value={
              this.props.checked?.has(item.url)
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onToggleItem(item)}
          />
        )}
        <Octicon className="icon" symbol={item.icon} />
        <TooltippedContent
          className="name"
          tooltip={item.text[0]}
          onlyWhenOverflowed={true}
          tagName="div"
        >
          <HighlightText text={item.text[0]} highlight={matches.title} />
        </TooltippedContent>
        {item.archived && <div className="archived">Archived</div>}
        {conflict !== undefined && (
          <TooltippedContent
            className="conflict"
            tooltip={conflict}
            tagName="div"
          >
            Already exists
          </TooltippedContent>
        )}
      </div>
    )
  }

  private renderPostFilter = () => {
    const tooltip = 'Refresh the list of repositories'

    return (
      <Button
        disabled={this.props.loading}
        onClick={this.refreshRepositories}
        ariaLabel={tooltip}
        tooltip={tooltip}
      >
        <Octicon
          symbol={syncClockwise}
          className={this.props.loading ? 'spin' : undefined}
        />
      </Button>
    )
  }

  private renderNoItems = () => {
    const { loading, repositories, account } = this.props

    if (loading && (repositories === null || repositories.length === 0)) {
      return (
        <div className="no-items loading">{`Loading repositories from ${account.friendlyEndpoint}…`}</div>
      )
    }

    if (this.props.filterText.length !== 0) {
      return (
        <div className="no-items no-results-found">
          <div>
            Sorry, I can't find any repository matching{' '}
            <Ref>{this.props.filterText}</Ref>
          </div>
        </div>
      )
    }

    return (
      <div className="no-items empty-repository-list">
        <div>
          Looks like there are no repositories for{' '}
          <Ref>{this.props.account.login}</Ref> on {account.friendlyEndpoint}.{' '}
          <LinkButton onClick={this.refreshRepositories}>
            Refresh this list
          </LinkButton>{' '}
          if you've created a repository recently.
        </div>
      </div>
    )
  }
}
