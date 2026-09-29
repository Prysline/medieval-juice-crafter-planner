/**
 * Stable persistence identity for a safely computed ordered recipe sequence.
 *
 * This contract intentionally depends only on canonical ordered ingredient IDs,
 * not on generator layer, search order, candidate budget, or display name.
 * Existing computed candidate IDs already use this shape, so adopting the helper
 * does not require inventory migration.
 */
export function computedRecipeIdentity(
  ingredientIds: readonly string[],
): string {
  for (const ingredientId of ingredientIds) {
    if (ingredientId.includes('+')) {
      throw new Error(
        `Ingredient id cannot contain "+" in computed recipe identity: ${ingredientId}`,
      )
    }
  }

  return `computed:${ingredientIds.join('+')}`
}


export function ingredientIdsFromComputedRecipeIdentity(
  identity: string,
): string[] | null {
  if (!identity.startsWith('computed:')) return null

  const payload = identity.slice('computed:'.length)
  if (!payload) return null

  const ingredientIds = payload.split('+')
  if (
    ingredientIds.length === 0 ||
    ingredientIds.some(
      (ingredientId) =>
        ingredientId.length === 0 || ingredientId.includes('+'),
    )
  ) {
    return null
  }

  return computedRecipeIdentity(ingredientIds) === identity
    ? ingredientIds
    : null
}
