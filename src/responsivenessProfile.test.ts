import { describe, expect, it } from 'vitest'
import { customers } from './data/customers'
import { buildCustomerRecipeSearches } from './App'
import {
  IntermediateJuiceInventoryEntry,
  intermediateJuiceInventoryEntries,
  searchIntermediateJuiceEntries,
  searchInventoryRecipeEntries,
} from './OptimizerTools'
import {
  buildRecipeCandidatePool,
  recipeCandidateEntriesForInventoryEditor,
  type RecipeCandidatePoolEntry,
} from './domain/recipeCandidatePool'
import { recipeEntryMatchesResearchFilters } from './domain/listFilters'
import {
  matchingRecipeCandidatesForCustomer,
} from './domain/matching'
import {
  sortFullMatchCandidatesByIngredientCost,
} from './domain/customerRecommendation'

const PROFILE_PROGRESS = 'juice-blender-unlocked' as const

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function measureMs(
  run: () => unknown,
  iterations = 7,
): { medianMs: number; samplesMs: number[] } {
  run()
  const samplesMs: number[] = []
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now()
    run()
    samplesMs.push(performance.now() - startedAt)
  }
  return {
    medianMs: median(samplesMs),
    samplesMs,
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

function recipeSearchText(entry: RecipeCandidatePoolEntry): string {
  const recipe = entry.candidate
  return [
    recipe.name,
    ...recipe.ingredients,
    ...recipe.effects.map((effect) => effect.name),
    ...(recipe.effectAmbiguity?.candidates.map(
      (effect) => effect.name,
    ) ?? []),
    ...recipe.equipment,
  ]
    .join(' ')
    .toLocaleLowerCase('zh-Hant')
}

function sortRecipeEntries(
  entries: readonly RecipeCandidatePoolEntry[],
): RecipeCandidatePoolEntry[] {
  const order = new Map(
    entries.map((entry, index) => [entry.id, index]),
  )
  return [...entries].sort((leftEntry, rightEntry) => {
    const left = leftEntry.candidate
    const right = rightEntry.candidate

    if (left.salePrice === null && right.salePrice === null) {
      return (
        (order.get(leftEntry.id) ?? 0) -
        (order.get(rightEntry.id) ?? 0)
      )
    }
    if (left.salePrice === null) return 1
    if (right.salePrice === null) return -1
    return (
      right.salePrice - left.salePrice ||
      (order.get(leftEntry.id) ?? 0) -
        (order.get(rightEntry.id) ?? 0)
    )
  })
}

function customerSearchTexts(
  pool: ReturnType<typeof buildRecipeCandidatePool>,
): string[] {
  const searches = buildCustomerRecipeSearches(
    pool,
    PROFILE_PROGRESS,
  )

  return customers.map((customer) => {
    const candidates =
      searches.get(customer.id)?.allowComputed.candidates ?? []
    const matches = sortFullMatchCandidatesByIngredientCost(
      matchingRecipeCandidatesForCustomer(
        [...candidates],
        customer,
      ),
      'minimum',
    )

    return [
      customer.name,
      customer.occupation,
      ...(customer.preferences ?? []).map(
        (preference) => preference.value,
      ),
      ...matches.map((recipe) => recipe.name),
    ]
      .join(' ')
      .toLocaleLowerCase('zh-Hant')
  })
}

function intermediateQuery(
  entries: readonly IntermediateJuiceInventoryEntry[],
  query: string,
) {
  return searchIntermediateJuiceEntries(entries, query)
}

describe('production-scale responsiveness profile', () => {
  it('prints current candidate counts and representative CPU timings', () => {
    const pool = buildRecipeCandidatePool(PROFILE_PROGRESS)
    const recipes = recipeListEntries(pool.entries)
    const inventory = recipeCandidateEntriesForInventoryEditor(pool)
    const intermediate = intermediateJuiceInventoryEntries(
      inventory,
      PROFILE_PROGRESS,
    )
    const recipeText = recipes.map(recipeSearchText)
    const customerText = customerSearchTexts(pool)

    const result = {
      counts: {
        poolEntries: pool.entries.length,
        recipeListEntries: recipes.length,
        inventoryRecipeEntries: inventory.length,
        intermediateJuiceEntries: intermediate.length,
        customers: customers.length,
      },
      timings: {
        customerQuery: measureMs(() =>
          customerText.filter((text) => text.includes('檸')),
        ),
        recipeTextQuery: measureMs(() =>
          recipeText.filter((text) => text.includes('檸')),
        ),
        recipeResearchFilter: measureMs(() =>
          recipes.filter((entry) =>
            recipeEntryMatchesResearchFilters(entry, {
              ingredientCount: null,
              ingredientId: null,
              confirmedEffect: null,
              possibleEffect: null,
              source: 'computed',
              price: 'all',
            }),
          ),
        ),
        recipeSalePriceSort: measureMs(() =>
          sortRecipeEntries(recipes),
        ),
        inventoryComboboxEmpty: measureMs(
          () => searchInventoryRecipeEntries(inventory, ''),
          5,
        ),
        inventoryComboboxBroad: measureMs(
          () => searchInventoryRecipeEntries(inventory, '檸'),
          5,
        ),
        inventoryComboboxNarrow: measureMs(
          () => searchInventoryRecipeEntries(inventory, 'lemon pear'),
          5,
        ),
        intermediateComboboxBroad: measureMs(
          () => intermediateQuery(intermediate, '檸'),
          5,
        ),
      },
    }

    console.log(
      '[responsiveness-profile]',
      JSON.stringify(result, null, 2),
    )

    expect(result.counts.recipeListEntries).toBeGreaterThan(1000)
    expect(result.counts.inventoryRecipeEntries).toBeGreaterThan(8)
    expect(result.counts.intermediateJuiceEntries).toBeGreaterThan(0)
    expect(result.counts.customers).toBe(customers.length)
  }, 20_000)
})
