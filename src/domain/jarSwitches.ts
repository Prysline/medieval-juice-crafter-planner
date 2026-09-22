export interface InitialJarSwitchState {
  recipeId: string | null
  servings: number
}

/**
 * Minimum recipe-type switches implied by the initial physical jar contents.
 *
 * Each distinct required recipe type can be covered without a switch when:
 * - at least one initially non-empty jar already contains that type, or
 * - an initially empty physical jar can take that type as its first fill.
 *
 * Every remaining distinct type requires at least one type switch. This is a
 * lower bound that the physical schedule is required to realize; the queue
 * allocator must not create extra switches merely to parallelize same-type
 * chunks.
 */
export function minimumJarTypeSwitchesForInitialJars(
  jars: readonly InitialJarSwitchState[],
  recipeIds: readonly string[],
): number {
  const initialRecipeIds = new Set(
    jars.flatMap((jar) =>
      jar.recipeId && jar.servings > 0 ? [jar.recipeId] : [],
    ),
  )
  const initiallyEmptyJarCount = jars.filter(
    (jar) => !jar.recipeId || jar.servings <= 0,
  ).length
  const unmatchedRecipeKinds = [...new Set(recipeIds)].filter(
    (recipeId) => !initialRecipeIds.has(recipeId),
  ).length

  return Math.max(
    0,
    unmatchedRecipeKinds - initiallyEmptyJarCount,
  )
}
