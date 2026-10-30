import * as React from 'react'

import { Repository } from '../../models/repository'
import { Octicon, iconForRepository } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Repositoryish } from './group-repositories'
import { HighlightText } from '../lib/highlight-text'
import { IMatches } from '../../lib/fuzzy-find'
import { IAheadBehind } from '../../models/branch'
import classNames from 'classnames'
import { createObservableRef } from '../lib/observable-ref'
import { Tooltip } from '../lib/tooltip'
import { enableAccessibleListToolTips } from '../../lib/feature-flag'
import { TooltippedContent } from '../lib/tooltipped-content'

interface IRepositoryListItemProps {
  readonly repository: Repositoryish

  /** Does the repository need to be disambiguated in the list? */
  readonly needsDisambiguation: boolean

  /** The characters in the repository name to highlight */
  readonly matches: IMatches

  /** Number of commits this local repo branch is behind or ahead of its remote branch */
  readonly aheadBehind: IAheadBehind | null

  /** Number of uncommitted changes */
  readonly changedFilesCount: number

  /** Whether this repository is marked as a favorite */
  readonly isFavorite: boolean

  /** Folder nesting depth for indentation (0 = no folder or root folder) */
  readonly folderDepth?: number

  /**
   * The title to show, when the repository is a linked worktree listed under
   * its parent. Defaults to the alias or the name of the repository.
   */
  readonly worktreeTitle?: string

  /** How many linked worktrees are listed underneath this repository. */
  readonly worktreeCount?: number

  /** Whether the linked worktrees underneath this repository are shown. */
  readonly worktreesExpanded?: boolean

  /** Called to show or hide the linked worktrees underneath this repository. */
  readonly onToggleWorktrees?: (repository: Repositoryish) => void
}

/**
 * How far each level of the repository tree is indented: the width of the
 * chevron column, so a child's chevron sits under its parent's icon.
 */
const TreeIndentWidth = 20

/**
 * The indentation of a repository list row (a folder header or a repository)
 * at the given depth, plus one guide line per ancestor level, drawn by the
 * row's background under each ancestor's chevron.
 */
export function getTreeIndentStyle(
  depth: number
): React.CSSProperties | undefined {
  if (depth <= 0) {
    return undefined
  }

  const indent = depth * TreeIndentWidth
  return {
    paddingLeft: `calc(var(--spacing) + ${indent}px)`,
    backgroundSize: `${indent}px 100%`,
  }
}

/** A repository item. */
export class RepositoryListItem extends React.Component<
  IRepositoryListItemProps,
  {}
> {
  private readonly listItemRef = createObservableRef<HTMLDivElement>()
  private readonly worktreesToggleRef = createObservableRef<HTMLSpanElement>()

  public render() {
    const repository = this.props.repository
    const gitHubRepo =
      repository instanceof Repository ? repository.gitHubRepository : null
    const hasChanges = this.props.changedFilesCount > 0

    const alias: string | null =
      repository instanceof Repository ? repository.alias : null

    let prefix: string | null = null
    if (this.props.needsDisambiguation && gitHubRepo) {
      prefix = `${gitHubRepo.owner.login}/`
    }

    const { worktreeTitle } = this.props
    const classNameList = classNames('name', {
      alias: alias !== null && worktreeTitle === undefined,
    })

    const depth = this.props.folderDepth ?? 0
    const depthStyle = getTreeIndentStyle(depth)

    return (
      <div
        className="repository-list-item"
        ref={this.listItemRef}
        style={depthStyle}
      >
        <Tooltip
          target={this.listItemRef}
          disabled={enableAccessibleListToolTips()}
        >
          {this.renderTooltip()}
        </Tooltip>

        {this.renderWorktreesToggle()}

        <Octicon
          className="icon-for-repository"
          symbol={
            worktreeTitle !== undefined
              ? octicons.fileDirectory
              : iconForRepository(repository)
          }
        />

        <div className={classNames(classNameList)}>
          {prefix ? <span className="prefix">{prefix}</span> : null}
          <HighlightText
            text={worktreeTitle ?? alias ?? repository.name}
            highlight={this.props.matches.title}
          />
        </div>

        {repository instanceof Repository &&
          renderRepoIndicators({
            aheadBehind: this.props.aheadBehind,
            hasChanges: hasChanges,
            isFavorite: this.props.isFavorite,
          })}
      </div>
    )
  }

  /**
   * The chevron that shows or hides this repository's worktrees. Every row
   * reserves its column, like a tree, so names stay aligned and the chevron
   * is big enough to hit without selecting the row by mistake.
   */
  private renderWorktreesToggle() {
    const { worktreeCount = 0, worktreesExpanded = false } = this.props
    if (worktreeCount === 0) {
      return <span className="worktrees-toggle-spacer" />
    }

    const label = `${worktreesExpanded ? 'Hide' : 'Show'} ${worktreeCount} ${
      worktreeCount === 1 ? 'worktree' : 'worktrees'
    }`

    return (
      <span
        className={classNames('worktrees-toggle', {
          expanded: worktreesExpanded,
        })}
        ref={this.worktreesToggleRef}
        role="button"
        tabIndex={-1}
        aria-label={label}
        aria-expanded={worktreesExpanded}
        onMouseDown={this.onWorktreesToggleMouseDown}
        onMouseUp={this.stopPropagation}
        onClick={this.onWorktreesToggleClick}
        onKeyDown={this.onWorktreesToggleKeyDown}
      >
        <Tooltip target={this.worktreesToggleRef}>{label}</Tooltip>
        <Octicon symbol={octicons.chevronRight} />
      </span>
    )
  }

  // Selection happens on mouse down and up, so the toggle swallows both and
  // only expands or collapses the worktrees.
  private onWorktreesToggleMouseDown = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  private stopPropagation = (event: React.MouseEvent) => event.stopPropagation()

  private onWorktreesToggleClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    this.props.onToggleWorktrees?.(this.props.repository)
  }

  private onWorktreesToggleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      this.props.onToggleWorktrees?.(this.props.repository)
    }
  }

  private renderTooltip() {
    const repo = this.props.repository
    const gitHubRepo = repo instanceof Repository ? repo.gitHubRepository : null
    const alias = repo instanceof Repository ? repo.alias : null
    const realName = gitHubRepo ? gitHubRepo.fullName : repo.name

    return (
      <>
        <div>
          <strong>{realName}</strong>
          {alias && <> ({alias})</>}
        </div>
        <div>{repo.path}</div>
      </>
    )
  }

  public shouldComponentUpdate(nextProps: IRepositoryListItemProps): boolean {
    if (
      nextProps.repository instanceof Repository &&
      this.props.repository instanceof Repository
    ) {
      return (
        nextProps.repository.id !== this.props.repository.id ||
        nextProps.matches !== this.props.matches ||
        nextProps.isFavorite !== this.props.isFavorite ||
        nextProps.worktreeTitle !== this.props.worktreeTitle ||
        nextProps.worktreeCount !== this.props.worktreeCount ||
        nextProps.worktreesExpanded !== this.props.worktreesExpanded ||
        nextProps.folderDepth !== this.props.folderDepth
      )
    } else {
      return true
    }
  }
}

const renderRepoIndicators: React.FunctionComponent<{
  aheadBehind: IAheadBehind | null
  hasChanges: boolean
  isFavorite: boolean
}> = props => {
  return (
    <div className="repo-indicators">
      {props.isFavorite && renderFavoriteIndicator()}
      {props.aheadBehind && renderAheadBehindIndicator(props.aheadBehind)}
      {props.hasChanges && renderChangesIndicator()}
    </div>
  )
}

const renderFavoriteIndicator = () => {
  return (
    <TooltippedContent
      className="favorite-indicator"
      tooltip="Favorite repository"
      disabled={enableAccessibleListToolTips()}
    >
      <Octicon symbol={octicons.starFill} />
    </TooltippedContent>
  )
}

const renderAheadBehindIndicator = (aheadBehind: IAheadBehind) => {
  const { ahead, behind } = aheadBehind
  if (ahead === 0 && behind === 0) {
    return null
  }

  const aheadBehindTooltip =
    'The currently checked out branch is' +
    (behind ? ` ${commitGrammar(behind)} behind ` : '') +
    (behind && ahead ? 'and' : '') +
    (ahead ? ` ${commitGrammar(ahead)} ahead of ` : '') +
    'its tracked branch.'

  return (
    <TooltippedContent
      className="ahead-behind"
      tagName="div"
      tooltip={aheadBehindTooltip}
      disabled={enableAccessibleListToolTips()}
    >
      {ahead > 0 && <Octicon symbol={octicons.arrowUp} />}
      {behind > 0 && <Octicon symbol={octicons.arrowDown} />}
    </TooltippedContent>
  )
}

const renderChangesIndicator = () => {
  return (
    <TooltippedContent
      className="change-indicator-wrapper"
      tooltip="There are uncommitted changes in this repository"
      disabled={enableAccessibleListToolTips()}
    >
      <Octicon symbol={octicons.dotFill} />
    </TooltippedContent>
  )
}

export const commitGrammar = (commitNum: number) =>
  `${commitNum} commit${commitNum > 1 ? 's' : ''}` // english is hard
