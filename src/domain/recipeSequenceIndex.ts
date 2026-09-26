import type { RecipeCandidatePoolEntry } from './recipeCandidatePool'

export type RecipeIngredientEntryIndex = ReadonlyMap<
  string,
  readonly RecipeCandidatePoolEntry[]
>

export function buildRecipeIngredientEntryIndex(
  entries: readonly RecipeCandidatePoolEntry[],
): RecipeIngredientEntryIndex {
  const index = new Map<string, RecipeCandidatePoolEntry[]>()

  for (const entry of entries) {
    for (const ingredientId of new Set(entry.ingredientIds)) {
      const matches = index.get(ingredientId)
      if (matches) {
        matches.push(entry)
      } else {
        index.set(ingredientId, [entry])
      }
    }
  }

  return index
}

function containsContiguousSequence(
  recipeIngredientIds: readonly string[],
  selectedIngredientIds: readonly string[],
): boolean {
  if (selectedIngredientIds.length === 0) return true
  if (selectedIngredientIds.length > recipeIngredientIds.length) return false

  const lastStart =
    recipeIngredientIds.length - selectedIngredientIds.length

  for (let start = 0; start <= lastStart; start += 1) {
    let matches = true

    for (
      let offset = 0;
      offset < selectedIngredientIds.length;
      offset += 1
    ) {
      if (
        recipeIngredientIds[start + offset] !==
        selectedIngredientIds[offset]
      ) {
        matches = false
        break
      }
    }

    if (matches) return true
  }

  return false
}

export function recipeEntriesForContiguousSequence(
  entries: readonly RecipeCandidatePoolEntry[],
  index: RecipeIngredientEntryIndex,
  ingredientIds: readonly string[],
): readonly RecipeCandidatePoolEntry[] {
  if (ingredientIds.length === 0) return entries

  let anchorEntries: readonly RecipeCandidatePoolEntry[] | null = null

  for (const ingredientId of new Set(ingredientIds)) {
    const candidates = index.get(ingredientId) ?? []
    if (candidates.length === 0) return []
    if (
      anchorEntries === null ||
      candidates.length < anchorEntries.length
    ) {
      anchorEntries = candidates
    }
  }

  return (anchorEntries ?? []).filter((entry) =>
    containsContiguousSequence(entry.ingredientIds, ingredientIds),
  )
}
