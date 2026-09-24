export const JUICE_STATE_IDENTITY_PREFIX = 'juice-state:v1:' as const

/**
 * Stable identity for an unfinalized juice state.
 *
 * The identity depends only on the ordered ingredient IDs represented by the
 * production-path node. Finalized drinks continue to use recipeId instead.
 */
export function juiceStateIdentity(
  ingredientIds: readonly string[],
): string {
  if (ingredientIds.length === 0) {
    throw new Error('Juice-state identity requires at least one ingredient')
  }

  const encoded = ingredientIds.map((ingredientId) => {
    if (ingredientId.length === 0) {
      throw new Error('Juice-state identity cannot contain an empty ingredient id')
    }
    return encodeURIComponent(ingredientId)
  })

  return `${JUICE_STATE_IDENTITY_PREFIX}${encoded.join('/')}`
}

export function ingredientIdsFromJuiceStateIdentity(
  identity: string,
): string[] | null {
  if (!identity.startsWith(JUICE_STATE_IDENTITY_PREFIX)) {
    return null
  }

  const payload = identity.slice(JUICE_STATE_IDENTITY_PREFIX.length)
  if (payload.length === 0) return null

  try {
    const ingredientIds = payload
      .split('/')
      .map((part) => decodeURIComponent(part))

    if (
      ingredientIds.some((ingredientId) => ingredientId.length === 0) ||
      juiceStateIdentity(ingredientIds) !== identity
    ) {
      return null
    }

    return ingredientIds
  } catch {
    return null
  }
}

export function isJuiceStateIdentity(identity: string): boolean {
  return ingredientIdsFromJuiceStateIdentity(identity) !== null
}
