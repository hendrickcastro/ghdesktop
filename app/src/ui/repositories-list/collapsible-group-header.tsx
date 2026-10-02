import * as React from 'react'
import classNames from 'classnames'

import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { RepositoryListGroup } from './group-repositories'

interface ICollapsibleGroupHeaderProps {
  readonly group: RepositoryListGroup
  readonly collapsed: boolean
  readonly depth: number
  readonly icon: React.ReactNode
  readonly label: string
  readonly onToggle: (group: RepositoryListGroup) => void
  readonly onContextMenu: (
    group: RepositoryListGroup,
    event: React.MouseEvent
  ) => void
}

/**
 * A repository list group header that expands and collapses its group when
 * clicked, or when Enter or Space is pressed while it has focus.
 */
export class CollapsibleGroupHeader extends React.Component<ICollapsibleGroupHeaderProps> {
  private onClick = () => {
    this.props.onToggle(this.props.group)
  }

  private onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      this.props.onToggle(this.props.group)
    }
  }

  private onContextMenu = (event: React.MouseEvent) => {
    this.props.onContextMenu(this.props.group, event)
  }

  public render() {
    const { collapsed, depth, icon, label } = this.props
    const style = depth > 0 ? { paddingLeft: `${depth * 16}px` } : undefined

    return (
      <div
        className={classNames('filter-list-group-header', 'collapsible', {
          collapsed,
        })}
        style={style}
        role="button"
        tabIndex={-1}
        aria-expanded={!collapsed}
        onClick={this.onClick}
        onKeyDown={this.onKeyDown}
        onContextMenu={this.onContextMenu}
      >
        <Octicon symbol={octicons.chevronRight} className="collapse-chevron" />
        {icon}
        {label}
      </div>
    )
  }
}
