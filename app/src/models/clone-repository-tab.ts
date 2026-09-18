export enum CloneRepositoryTab {
  DotCom = 0,
  Enterprise,
  Generic,
  // Keep new tabs last: the TabBar selects by numeric index and the selected
  // tab is persisted, so inserting above would renumber the existing ones.
  AzureDevOps,
}
