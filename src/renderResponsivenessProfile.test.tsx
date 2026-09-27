import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CustomerRow,
  RecipeRow,
  buildCustomerRecipeSearches,
} from './App'
import { customers } from './data/customers'
import {
  customerRecipeRecommendationsFromSearch,
  sortFullMatchCandidatesByIngredientCost,
} from './domain/customerRecommendation'
import { matchingRecipeCandidatesForCustomer } from './domain/matching'
import {
  buildRecipeCandidatePool,
  type RecipeCandidatePoolEntry,
} from './domain/recipeCandidatePool'

const PROFILE_PROGRESS = 'juice-blender-unlocked' as const
const PROFILE_RECIPE_ROWS = 50

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function measure(
  render: () => string,
  iterations = 5,
): { medianMs: number; htmlChars: number } {
  render()
  const samples: number[] = []
  let html = ''
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now()
    html = render()
    samples.push(performance.now() - startedAt)
  }
  return {
    medianMs: median(samples),
    htmlChars: html.length,
  }
}

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

describe('production-scale list render profile', () => {
  it('prints server-render cost for current customer summaries and recipe rows', () => {
    const pool = buildRecipeCandidatePool(PROFILE_PROGRESS)
    const recipes = recipeListEntries(pool.entries)
    const recipeRows = recipes.slice(0, PROFILE_RECIPE_ROWS)

    const satisfactionByVillage = {
      'east-harbor': 9999,
      'tranquil-fountain': 9999,
      'ibex-statue': 9999,
    }

    const searches = buildCustomerRecipeSearches(
      pool,
      PROFILE_PROGRESS,
    )

    const customerModels = customers.map((customer) => {
      const customerSearches = searches.get(customer.id)
      const candidates =
        customerSearches?.allowComputed.candidates ?? []
      const matches = sortFullMatchCandidatesByIngredientCost(
        matchingRecipeCandidatesForCustomer(
          [...candidates],
          customer,
        ),
        'minimum',
      )
      return {
        customer,
        matches,
        recommendations:
          customerRecipeRecommendationsFromSearch(
            customerSearches?.observedOnly.candidates ?? [],
            customerSearches?.allowComputed.candidates ?? [],
            customer,
            'minimum',
          ),
      }
    })

    const recipeRender = measure(() =>
      renderToStaticMarkup(
        <div>
          {recipeRows.map((entry) => (
            <RecipeRow
              key={entry.id}
              entry={entry}
              currentProgress={PROFILE_PROGRESS}
              satisfactionByVillage={satisfactionByVillage}
            />
          ))}
        </div>,
      ),
    )

    const customerRender = measure(() =>
      renderToStaticMarkup(
        <div>
          {customerModels.map(
            ({ customer, matches, recommendations }) => (
              <CustomerRow
                key={customer.id}
                customer={customer}
                matches={matches}
                recommendations={recommendations}
                recommendationCostMode="minimum"
                unlocked
                formal={false}
                suppliedToday={false}
                comparisonSelected={false}
                onToggleFormal={() => {}}
                onToggleSupplied={() => {}}
                onToggleComparison={() => {}}
              />
            ),
          )}
        </div>,
      ),
    )

    console.log('[render-responsiveness-profile]', {
      poolEntries: pool.entries.length,
      recipeListEntries: recipes.length,
      recipeRowsRendered: recipeRows.length,
      customerRowsRendered: customerModels.length,
      recipeRender,
      customerRender,
      recipeCharsPerRow:
        recipeRender.htmlChars / recipeRows.length,
      customerCharsPerRow:
        customerRender.htmlChars / customerModels.length,
    })

    expect(recipes.length).toBeGreaterThan(1000)
    expect(recipeRows).toHaveLength(PROFILE_RECIPE_ROWS)
    expect(customerModels.length).toBe(customers.length)
    expect(recipeRender.htmlChars).toBeGreaterThan(0)
    expect(customerRender.htmlChars).toBeGreaterThan(0)
  }, 20_000)
})
