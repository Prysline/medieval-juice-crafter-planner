import type { RecipeCandidatePoolEntry } from './recipeCandidatePool'

function sequenceKey(ingredientIds: readonly string[]): string {
  return JSON.stringify(ingredientIds)
}

export type ContiguousRecipeSequenceIndex = ReadonlyMap<
  string,
  readonly RecipeCandidatePoolEntry[]
>

export function buildContiguousRecipeSequenceIndex(
  entries: readonly RecipeCandidatePoolEntry[],
): ContiguousRecipeSequenceIndex {
  const index = new Map<string, RecipeCandidatePoolEntry[]>()

  for (const entry of entries) {
    const entryKeys = new Set<string>()

    for (let start = 0; start < entry.ingredientIds.length; start += 1) {
      for (
        let end = start + 1;
        end <= entry.ingredientIds.length;
        end += 1
      ) {
        entryKeys.add(sequenceKey(entry.ingredientIds.slice(start, end)))
      }
    }

    for (const key of entryKeys) {
      const matches = index.get(key)
      if (matches) {
        matches.push(entry)
      } else {
        index.set(key, [entry])
      }
    }
  }

  return index
}

export function recipeEntriesForContiguousSequence(
  entries: readonly RecipeCandidatePoolEntry[],
  index: ContiguousRecipeSequenceIndex,
  ingredientIds: readonly string[],
): readonly RecipeCandidatePoolEntry[] {
  if (ingredientIds.length === 0) return entries
  return index.get(sequenceKey(ingredientIds)) ?? []
}
