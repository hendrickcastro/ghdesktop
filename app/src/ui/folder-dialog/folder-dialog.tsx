import * as React from 'react'

import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { TextBox } from '../lib/text-box'
import { Repository } from '../../models/repository'

interface IFolderDialogProps {
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void

  /** If provided, the dialog is in "rename" mode for this folder. */
  readonly folderId?: number
  /** The current name of the folder (for rename mode). */
  readonly currentName?: string
  /** Parent folder ID for creating a subfolder. */
  readonly parentId?: number | null
  /** Repositories to move into the folder once it's created. */
  readonly repositoriesToMove?: ReadonlyArray<Repository>
}

interface IFolderDialogState {
  readonly folderName: string
}

export class FolderDialog extends React.Component<
  IFolderDialogProps,
  IFolderDialogState
> {
  public constructor(props: IFolderDialogProps) {
    super(props)
    this.state = { folderName: props.currentName ?? '' }
  }

  public render() {
    const isRename = this.props.folderId !== undefined
    const isSubfolder = !isRename && this.props.parentId != null
    const verb = isRename ? 'Rename' : 'Create'
    const noun = isSubfolder ? 'Subfolder' : 'Folder'

    return (
      <Dialog
        id="folder-dialog"
        title={__DARWIN__ ? `${verb} ${noun}` : `${verb} ${noun.toLowerCase()}`}
        ariaDescribedBy="folder-dialog-description"
        onDismissed={this.props.onDismissed}
        onSubmit={this.onSubmit}
      >
        <DialogContent>
          <p id="folder-dialog-description">
            {isRename
              ? 'Enter a new name for the folder.'
              : `Enter a name for the new ${noun.toLowerCase()}.${this.renderMoveNote()}`}
          </p>
          <p>
            <TextBox
              ariaLabel="Folder name"
              value={this.state.folderName}
              onValueChanged={this.onNameChanged}
              autoFocus={true}
            />
          </p>
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={
              __DARWIN__ ? `${verb} ${noun}` : `${verb} ${noun.toLowerCase()}`
            }
            okButtonDisabled={this.state.folderName.trim().length === 0}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  /** Says which repositories will be moved into the new folder, if any. */
  private renderMoveNote() {
    const count = this.props.repositoriesToMove?.length ?? 0
    return count === 0
      ? ''
      : ` The ${count} selected ${
          count === 1 ? 'repository' : 'repositories'
        } will be moved into it.`
  }

  private onNameChanged = (folderName: string) => {
    this.setState({ folderName })
  }

  private onSubmit = () => {
    const name = this.state.folderName.trim()
    if (name.length === 0) {
      return
    }

    if (this.props.folderId !== undefined) {
      this.props.dispatcher.renameFolder(this.props.folderId, name)
    } else {
      const { dispatcher, parentId, repositoriesToMove } = this.props
      dispatcher
        .createFolder(name, parentId ?? null)
        .then(folder =>
          repositoriesToMove !== undefined && repositoriesToMove.length > 0
            ? dispatcher.setRepositoriesFolder(repositoriesToMove, folder.id)
            : undefined
        )
        .catch(e => dispatcher.postError(e))
    }
    this.props.onDismissed()
  }
}
