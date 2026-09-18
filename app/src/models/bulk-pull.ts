/** How pulling one repository of a batch ended. */
export type BulkPullOutcome =
  /** The pull brought in new commits. */
  | { readonly kind: 'updated' }
  /** The pull ran and there was nothing new. */
  | { readonly kind: 'up-to-date' }
  /** The repository wasn't in a state that can be pulled; nothing was run. */
  | { readonly kind: 'skipped'; readonly reason: string }
  /** Git was run and reported an error. */
  | { readonly kind: 'failed'; readonly error: string }

export interface IBulkPullSummary {
  readonly updated: number
  readonly upToDate: number
  readonly skipped: number
  readonly failed: number
}

export function summarizeBulkPull(
  outcomes: Iterable<BulkPullOutcome>
): IBulkPullSummary {
  const summary = { updated: 0, upToDate: 0, skipped: 0, failed: 0 }

  for (const outcome of outcomes) {
    switch (outcome.kind) {
      case 'updated':
        summary.updated++
        break
      case 'up-to-date':
        summary.upToDate++
        break
      case 'skipped':
        summary.skipped++
        break
      case 'failed':
        summary.failed++
        break
    }
  }

  return summary
}

/** One line for the dialog footer, e.g. "3 updated · 5 up to date · 1 failed". */
export function formatBulkPullSummary(summary: IBulkPullSummary): string {
  const parts: string[] = []

  if (summary.updated > 0) {
    parts.push(`${summary.updated} updated`)
  }
  if (summary.upToDate > 0) {
    parts.push(`${summary.upToDate} already up to date`)
  }
  if (summary.skipped > 0) {
    parts.push(`${summary.skipped} skipped`)
  }
  if (summary.failed > 0) {
    parts.push(`${summary.failed} failed`)
  }

  return parts.join(' · ')
}
