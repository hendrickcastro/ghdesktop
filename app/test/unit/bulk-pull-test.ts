import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  BulkPullOutcome,
  formatBulkPullSummary,
  summarizeBulkPull,
} from '../../src/models/bulk-pull'

describe('bulk pull summary', () => {
  const outcomes: ReadonlyArray<BulkPullOutcome> = [
    { kind: 'updated' },
    { kind: 'updated' },
    { kind: 'up-to-date' },
    { kind: 'skipped', reason: 'main has no upstream branch' },
    { kind: 'failed', error: 'error: cannot pull with rebase' },
  ]

  it('counts each outcome kind', () => {
    assert.deepEqual(summarizeBulkPull(outcomes), {
      updated: 2,
      upToDate: 1,
      skipped: 1,
      failed: 1,
    })
  })

  it('formats only the non-zero counts', () => {
    assert.equal(
      formatBulkPullSummary(summarizeBulkPull(outcomes)),
      '2 updated · 1 already up to date · 1 skipped · 1 failed'
    )
    assert.equal(
      formatBulkPullSummary(summarizeBulkPull([{ kind: 'up-to-date' }])),
      '1 already up to date'
    )
    assert.equal(formatBulkPullSummary(summarizeBulkPull([])), '')
  })
})
