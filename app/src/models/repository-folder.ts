/** A folder used to group repositories in the sidebar */
export interface IRepositoryFolder {
  readonly id: number
  readonly name: string
  readonly parentId: number | null
}
