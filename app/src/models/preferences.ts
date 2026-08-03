export enum PreferencesTab {
  Accounts,
  Integrations,
  Git,
  Appearance,
  Notifications,
  Prompts,
  Advanced,
  Accessibility,
  // Keep new tabs last: TabBar selects by numeric index, so inserting above
  // renumbers every tab after it.
  AI,
}
