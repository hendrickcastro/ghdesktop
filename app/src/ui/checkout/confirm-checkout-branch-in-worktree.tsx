import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Repository } from '../../models/repository'
import { Branch } from '../../models/branch'
import { UncommittedChangesStrategy } from '../../models/uncommitted-changes-strategy'
import { Dispatcher } from '../dispatcher'
import { Row } from '../lib/row'
import { Ref } from '../lib/ref'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'

interface IConfirmCheckoutBranchInWorktreeProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly branch: Branch
  /** The path of the worktree that has the branch checked out */
  readonly worktreePath: string
  /** How to handle local changes, already settled with the user */
  readonly strategy: UncommittedChangesStrategy
  readonly onDismissed: () => void
}

interface IConfirmCheckoutBranchInWorktreeState {
  readonly isCheckingOut: boolean
}

/**
 * Dialog to confirm checking out a branch that another worktree already has
 * checked out.
 */
export class ConfirmCheckoutBranchInWorktreeDialog extends React.Component<
  IConfirmCheckoutBranchInWorktreeProps,
  IConfirmCheckoutBranchInWorktreeState
> {
  public constructor(props: IConfirmCheckoutBranchInWorktreeProps) {
    super(props)

    this.state = { isCheckingOut: false }
  }

  public render() {
    const { branch, worktreePath } = this.props
    const title = __DARWIN__
      ? 'Branch Checked Out in Another Worktree'
      : 'Branch checked out in another worktree'

    return (
      <Dialog
        id="checkout-branch-in-worktree"
        type="warning"
        title={title}
        loading={this.state.isCheckingOut}
        disabled={this.state.isCheckingOut}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        ariaDescribedBy="checkout-branch-in-worktree-confirmation"
        role="alertdialog"
      >
        <DialogContent>
          <Row id="checkout-branch-in-worktree-confirmation">
            <div>
              <Ref>{branch.name}</Ref> is already checked out in the worktree at{' '}
              <Ref>{worktreePath}</Ref>.
            </div>
          </Row>
          <Row>
            Checking it out here too means both worktrees share the branch: a
            commit made in one moves the branch under the other, which then
            shows the difference as uncommitted changes.
          </Row>
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup
            destructive={true}
            okButtonText={__DARWIN__ ? 'Checkout Anyway' : 'Checkout anyway'}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onSubmit = async () => {
    const { dispatcher, repository, branch, strategy, onDismissed } = this.props

    this.setState({ isCheckingOut: true })

    try {
      await dispatcher.checkoutBranch(repository, branch, strategy, true)
    } finally {
      this.setState({ isCheckingOut: false })
    }

    onDismissed()
  }
}
