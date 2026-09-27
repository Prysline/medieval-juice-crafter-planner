import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RecipeRow } from './App'
import {
  buildRecipeCandidatePool,
  type RecipeCandidatePoolEntry,
} from './domain/recipeCandidatePool'

const PROFILE_PROGRESS = 'juice-blender-unlocked' as const
const PROFILE_ROW_COUNT = 50
const COLLAPSED_MARKUP_BUDGET = 30_000
const RENDER_MEDIAN_BUDGET_MS = 80

function recipeListEntries(
  entries: readonly RecipeCandidatePoolEntry[],
): RecipeCandidatePoolEntry[] {
  return entries.filter(
    (entry) =>
      entry.availableAtCurrentProgress &&
      (
        entry.inGeneratedSearchScope ||
        entry.sources.includes('saved') ||
        entry.sources.includes('observed')
      ),
  )
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function renderRows(rows: readonly RecipeCandidatePoolEntry[]): string {
  return renderToStaticMarkup(
    <div>
      {rows.map((entry) => (
        <RecipeRow
          key={entry.id}
          entry={entry}
          currentProgress={PROFILE_PROGRESS}
          satisfactionByVillage={{
            'east-harbor': 9999,
            'tranquil-fountain': 9999,
            'ibex-statue': 9999,
          }}
        />
      ))}
    </div>,
  )
}

describe('production-scale collapsed recipe row responsiveness', () => {
  it('keeps 50 collapsed recipe rows lightweight without reducing recipe authority', () => {
    const pool = buildRecipeCandidatePool(PROFILE_PROGRESS)
    const entries = recipeListEntries(pool.entries)
    const rows = entries.slice(0, PROFILE_ROW_COUNT)

    expect(entries.length).toBeGreaterThan(10_000)
    expect(rows).toHaveLength(PROFILE_ROW_COUNT)

    renderRows(rows)
    const samples: number[] = []
    let html = ''
    for (let index = 0; index < 3; index += 1) {
      const startedAt = performance.now()
      html = renderRows(rows)
      samples.push(performance.now() - startedAt)
    }
    const medianMs = median(samples)

    console.log('[recipe-row-responsiveness-regression]', {
      recipeListEntries: entries.length,
      rowsRendered: rows.length,
      medianMs,
      htmlChars: html.length,
    })

    expect(html).not.toContain('class="row-details"')
    expect(html.length).toBeLessThan(COLLAPSED_MARKUP_BUDGET)
    expect(medianMs).toBeLessThan(RENDER_MEDIAN_BUDGET_MS)
  }, 20_000)
})
