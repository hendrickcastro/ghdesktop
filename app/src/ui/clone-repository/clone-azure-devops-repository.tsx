import * as React from 'react'
import memoizeOne from 'memoize-one'
import { DialogContent } from '../dialog'
import { TextBox } from '../lib/text-box'
import { Row } from '../lib/row'
import { Button } from '../lib/button'
import { Select } from '../lib/select'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { SectionFilterList, getText } from '../lib/section-filter-list'
import { IFilterListGroup } from '../lib/filter-list'
import { IMatches, match } from '../../lib/fuzzy-find'
import { Octicon, syncClockwise } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { HighlightText } from '../lib/highlight-text'
import { TooltippedContent } from '../lib/tooltipped-content'
import { ClickSource } from '../lib/list'
import { Ref } from '../lib/ref'
import { LinkButton } from '../lib/link-button'
import {
  IAzureDevOpsOrganization,
  IAzureDevOpsRepository,
  fetchAzureDevOpsRepositories,
} from '../../lib/azure-devops/azure-devops'
import { ICloneableRepositoryListItem } from './group-repositories'

interface ICloneAzureDevOpsRepositoryProps {
  /** Every organization the user has connected. Never empty here. */
  readonly organizations: ReadonlyArray<IAzureDevOpsOrganization>

  /** The organization whose repositories are listed. */
  readonly organization: IAzureDevOpsOrganization

  readonly onOrganizationChanged: (organization: IAzureDevOpsOrganization) => void

  /**
   * The path to clone to: one repository's folder normally, the parent folder
   * of every ticked repository while any are ticked.
   */
  readonly path: string

  /** Called when the destination path changes. */
  readonly onPathChanged: (path: string) => void

  /**
   * Called when the user should be prompted to choose a destination directory.
   */
  readonly onChooseDirectory: () => Promise<string | undefined>

  /** The highlighted repository, or null if none is. */
  readonly selectedItem: IAzureDevOpsRepository | null

  readonly onSelectionChanged: (
    selectedItem: IAzureDevOpsRepository | null
  ) => void

  /**
   * Repositories ticked for cloning together, by clone URL. Ticking any puts
   * the tab in multi-clone mode.
   */
  readonly checked: ReadonlyMap<string, IAzureDevOpsRepository>

  readonly onCheckedChanged: (
    repositories: ReadonlyArray<IAzureDevOpsRepository>,
    checked: boolean
  ) => void

  /**
   * Ticked repositories whose destination folder already has something in it,
   * by clone URL, with the reason. These are shown and left out of the clone.
   */
  readonly conflicts: ReadonlyMap<string, string>

  /** The contents of the filter text box. */
  readonly filterText: string

  readonly onFilterTextChanged: (filterText: string) => void

  /**
   * Fired when a row is activated by pointer or keyboard, so Enter on a
   * repository can start the clone the way it does on the GitHub tabs.
   */
  readonly onItemClicked: (
    repository: IAzureDevOpsRepository,
    source: ClickSource
  ) => void
}

interface ICloneAzureDevOpsRepositoryState {
  /** Repositories for the current organization, or null before they load. */
  readonly repositories: ReadonlyArray<IAzureDevOpsRepository> | null
  readonly loading: boolean
  readonly error: Error | null
}

const RowHeight = 31

/**
 * Repositories already fetched this session, per organization.
 *
 * Listing an organization means one request per team project, so it's slow
 * enough to be worth keeping between openings of the dialog. The refresh button
 * bypasses it.
 */
const repositoryCache = new Map<string, ReadonlyArray<IAzureDevOpsRepository>>()

const toListItem = (
  repo: IAzureDevOpsRepository
): ICloneableRepositoryListItem => ({
  id: repo.cloneUrl,
  text: [`${repo.project}/${repo.name}`],
  url: repo.cloneUrl,
  name: repo.name,
  // Azure DevOps repositories are private to the organization without
  // exception, which is what the lock has always meant in this list.
  icon: octicons.lock,
})

/** One group per team project, which is how Azure DevOps itself arranges them. */
function groupByProject(
  repositories: ReadonlyArray<IAzureDevOpsRepository> | null
): ReadonlyArray<IFilterListGroup<ICloneableRepositoryListItem>> {
  if (repositories === null) {
    return []
  }

  const groups = new Map<string, ICloneableRepositoryListItem[]>()

  for (const repo of repositories) {
    const items = groups.get(repo.project) ?? []
    items.push(toListItem(repo))
    groups.set(repo.project, items)
  }

  return [...groups.entries()].map(([identifier, items]) => ({
    identifier,
    items,
  }))
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

/**
 * The Azure DevOps tab of the clone dialog: pick an organization, pick one
 * repository - or tick several - and pick where they go.
 */
export class CloneAzureDevOpsRepository extends React.Component<
  ICloneAzureDevOpsRepositoryProps,
  ICloneAzureDevOpsRepositoryState
> {
  private getGroups = memoizeOne(groupByProject)
  private getVisible = memoizeOne(visibleItemsByGroup)

  public constructor(props: ICloneAzureDevOpsRepositoryProps) {
    super(props)

    this.state = {
      repositories: repositoryCache.get(props.organization.name) ?? null,
      loading: false,
      error: null,
    }
  }

  public componentDidMount() {
    if (this.state.repositories === null) {
      this.loadRepositories(false)
    }
  }

  public componentDidUpdate(prevProps: ICloneAzureDevOpsRepositoryProps) {
    if (prevProps.organization.name !== this.props.organization.name) {
      const cached = repositoryCache.get(this.props.organization.name) ?? null
      this.setState({ repositories: cached, error: null }, () => {
        if (cached === null) {
          this.loadRepositories(false)
        }
      })
    }
  }

  private loadRepositories = async (force: boolean) => {
    const { name } = this.props.organization

    if (!force && repositoryCache.has(name)) {
      this.setState({ repositories: repositoryCache.get(name) ?? null })
      return
    }

    this.setState({ loading: true, error: null })

    try {
      const repositories = await fetchAzureDevOpsRepositories(name)
      repositoryCache.set(name, repositories)

      // The user may have switched organization while this was in flight.
      if (this.props.organization.name === name) {
        this.setState({ repositories, loading: false })
      }
    } catch (e) {
      if (this.props.organization.name === name) {
        this.setState({ loading: false, error: e as Error })
      }
    }
  }

  private onRefresh = () => this.loadRepositories(true)

  private onOrganizationChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    const organization = this.props.organizations.find(
      o => o.name === event.currentTarget.value
    )

    if (organization !== undefined) {
      this.props.onOrganizationChanged(organization)
    }
  }

  private findRepository(item: ICloneableRepositoryListItem) {
    return this.state.repositories?.find(r => r.cloneUrl === item.url) ?? null
  }

  private findRepositories(items: ReadonlyArray<ICloneableRepositoryListItem>) {
    return items
      .map(item => this.findRepository(item))
      .filter((r): r is IAzureDevOpsRepository => r !== null)
  }

  private onSelectionChanged = (item: ICloneableRepositoryListItem | null) => {
    this.props.onSelectionChanged(
      item === null ? null : this.findRepository(item)
    )
  }

  private onItemClick = (
    item: ICloneableRepositoryListItem,
    source: ClickSource
  ) => {
    const repository = this.findRepository(item)

    if (repository !== null) {
      this.props.onItemClicked(repository, source)
    }
  }

  private onToggleItem =
    (item: ICloneableRepositoryListItem) =>
    (event: React.FormEvent<HTMLInputElement>) => {
      const repository = this.findRepository(item)

      if (repository !== null) {
        this.props.onCheckedChanged([repository], event.currentTarget.checked)
      }
    }

  private onToggleGroup =
    (identifier: string) => (event: React.FormEvent<HTMLInputElement>) => {
      const items = this.getVisibleItems().get(identifier) ?? []
      this.props.onCheckedChanged(
        this.findRepositories(items),
        event.currentTarget.checked
      )
    }

  private onToggleAllVisible = (event: React.FormEvent<HTMLInputElement>) => {
    const items = [...this.getVisibleItems().values()].flat()
    this.props.onCheckedChanged(
      this.findRepositories(items),
      event.currentTarget.checked
    )
  }

  private getVisibleItems() {
    return this.getVisible(
      this.getGroups(this.state.repositories),
      this.props.filterText
    )
  }

  /** On, Off or Mixed depending on how many of the items are ticked. */
  private checkboxValueFor(items: ReadonlyArray<ICloneableRepositoryListItem>) {
    const ticked = items.filter(i => this.props.checked.has(i.url)).length

    return ticked === 0
      ? CheckboxValue.Off
      : ticked === items.length
      ? CheckboxValue.On
      : CheckboxValue.Mixed
  }

  public render() {
    const { organizations, organization, selectedItem, checked, conflicts } =
      this.props
    const groups = this.getGroups(this.state.repositories)
    const selectedListItem =
      selectedItem === null
        ? null
        : groups
            .flatMap(g => g.items)
            .find(i => i.url === selectedItem.cloneUrl) ?? null

    const multiple = checked.size > 0
    const toClone = checked.size - conflicts.size

    return (
      <DialogContent className="clone-github-repository-content">
        {organizations.length > 1 && (
          <Row className="account-picker-row">
            <Select
              label="Organization"
              value={organization.name}
              onChange={this.onOrganizationChanged}
            >
              {organizations.map(o => (
                <option key={o.name} value={o.name}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Row>
        )}

        <Row>
          <SectionFilterList<ICloneableRepositoryListItem>
            className="clone-github-repo clone-azure-devops"
            rowHeight={RowHeight}
            selectedItem={selectedListItem}
            renderItem={this.renderItem}
            renderGroupHeader={this.renderGroupHeader}
            onSelectionChanged={this.onSelectionChanged}
            onItemClick={this.onItemClick}
            invalidationProps={{ groups, checked, conflicts }}
            groups={groups}
            filterText={this.props.filterText}
            onFilterTextChanged={this.props.onFilterTextChanged}
            renderNoItems={this.renderNoItems}
            renderPreFilter={this.renderSelectAll}
            renderPostFilter={this.renderPostFilter}
            placeholderText="Filter repositories"
          />
        </Row>

        <Row className="local-path-field">
          <TextBox
            value={this.props.path}
            label={
              multiple
                ? __DARWIN__
                  ? 'Local Folder'
                  : 'Local folder'
                : __DARWIN__
                ? 'Local Path'
                : 'Local path'
            }
            placeholder={multiple ? 'parent folder' : 'repository path'}
            onValueChanged={this.props.onPathChanged}
          />
          <Button onClick={this.props.onChooseDirectory}>Choose…</Button>
        </Row>

        {multiple && (
          <p className="clone-azure-devops-note">
            {toClone === 1
              ? 'The repository is cloned into its own subfolder here.'
              : `Each of the ${toClone} repositories is cloned into its own subfolder here.`}
            {conflicts.size > 0 &&
              ` ${conflicts.size} ${
                conflicts.size === 1 ? 'is' : 'are'
              } already there and will be skipped.`}
          </p>
        )}
      </DialogContent>
    )
  }

  private renderSelectAll = () => {
    const items = [...this.getVisibleItems().values()].flat()

    if (items.length === 0) {
      return null
    }

    const ticked = items.filter(i => this.props.checked.has(i.url)).length

    return (
      <Checkbox
        className="clone-azure-devops-select-all"
        value={this.checkboxValueFor(items)}
        onChange={this.onToggleAllVisible}
        label={
          this.props.filterText === ''
            ? `All (${ticked}/${items.length})`
            : `All shown (${ticked}/${items.length})`
        }
      />
    )
  }

  private renderGroupHeader = (identifier: string) => {
    const items = this.getVisibleItems().get(identifier) ?? []

    return (
      <div className="clone-repository-list-content clone-repository-list-group-header">
        <Checkbox
          value={this.checkboxValueFor(items)}
          onChange={this.onToggleGroup(identifier)}
          ariaLabelledBy={undefined}
        />
        <span className="group-name">{identifier}</span>
      </div>
    )
  }

  private renderItem = (
    item: ICloneableRepositoryListItem,
    matches: IMatches
  ) => {
    const conflict = this.props.conflicts.get(item.url)

    return (
      <div className="clone-repository-list-item">
        <Checkbox
          value={
            this.props.checked.has(item.url)
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={this.onToggleItem(item)}
        />
        <Octicon className="icon" symbol={item.icon} />
        <TooltippedContent
          className="name"
          tooltip={item.text[0]}
          onlyWhenOverflowed={true}
          tagName="div"
        >
          <HighlightText text={item.text[0]} highlight={matches.title} />
        </TooltippedContent>
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
        disabled={this.state.loading}
        onClick={this.onRefresh}
        ariaLabel={tooltip}
        tooltip={tooltip}
      >
        <Octicon
          symbol={syncClockwise}
          className={this.state.loading ? 'spin' : undefined}
        />
      </Button>
    )
  }

  private renderNoItems = () => {
    const { loading, repositories, error } = this.state
    const { organization, filterText } = this.props

    if (error !== null) {
      return (
        <div className="no-items empty-repository-list">
          <div>
            Couldn't list the repositories of <Ref>{organization.name}</Ref>:{' '}
            {error.message}{' '}
            <LinkButton onClick={this.onRefresh}>Try again</LinkButton>.
          </div>
        </div>
      )
    }

    if (loading && (repositories === null || repositories.length === 0)) {
      return (
        <div className="no-items loading">
          {`Loading repositories from dev.azure.com/${organization.name}…`}
        </div>
      )
    }

    if (filterText.length !== 0) {
      return (
        <div className="no-items no-results-found">
          <div>
            Sorry, I can't find any repository matching <Ref>{filterText}</Ref>
          </div>
        </div>
      )
    }

    return (
      <div className="no-items empty-repository-list">
        <div>
          Looks like <Ref>{organization.username}</Ref> can't see any
          repositories in <Ref>{organization.name}</Ref>.{' '}
          <LinkButton onClick={this.onRefresh}>Refresh this list</LinkButton>{' '}
          if you've created one recently, or check the PAT's scopes.
        </div>
      </div>
    )
  }
}
