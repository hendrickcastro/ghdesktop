import * as React from 'react'
import { IAPIRepository } from '../../lib/api'
import { IAzureDevOpsRepository } from '../../lib/azure-devops/azure-devops'

/**
 * A repository ticked for cloning as part of a batch, in the shape the clone
 * dialog needs and nothing more, so the GitHub and Azure DevOps tabs can share
 * one implementation of multi-clone.
 */
export interface ICloneCandidate {
  /** The clone URL; also the key a candidate is tracked by. */
  readonly url: string
  /** The repository name, which becomes its subfolder under the parent. */
  readonly name: string
  readonly defaultBranch?: string
}

export function cloneCandidateFromAPIRepository(
  repository: IAPIRepository
): ICloneCandidate {
  return {
    url: repository.clone_url,
    name: repository.name,
    defaultBranch: repository.default_branch,
  }
}

export function cloneCandidateFromAzureDevOps(
  repository: IAzureDevOpsRepository
): ICloneCandidate {
  return {
    url: repository.cloneUrl,
    name: repository.name,
    defaultBranch: repository.defaultBranch ?? undefined,
  }
}

interface IMultiCloneNoteProps {
  readonly checked: ReadonlyMap<string, ICloneCandidate>
  readonly conflicts: ReadonlyMap<string, string>
}

/**
 * The line under the path field while repositories are ticked: what the path
 * now means, and how many ticked repositories will be skipped.
 */
export class MultiCloneNote extends React.PureComponent<IMultiCloneNoteProps> {
  public render() {
    const { checked, conflicts } = this.props

    if (checked.size === 0) {
      return null
    }

    const toClone = checked.size - conflicts.size

    return (
      <p className="multi-clone-note">
        {toClone === 1
          ? 'The repository is cloned into its own subfolder here.'
          : `Each of the ${toClone} repositories is cloned into its own subfolder here.`}
        {conflicts.size > 0 &&
          ` ${conflicts.size} ${
            conflicts.size === 1 ? 'is' : 'are'
          } already there and will be skipped.`}
      </p>
    )
  }
}

/** The label for the path field, which means something else once repositories are ticked. */
export function pathFieldLabel(multiple: boolean): string {
  if (multiple) {
    return __DARWIN__ ? 'Local Folder' : 'Local folder'
  }

  return __DARWIN__ ? 'Local Path' : 'Local path'
}
