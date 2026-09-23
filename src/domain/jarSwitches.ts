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


export interface ReusableJarSwitchState {
  physicalJarId: string
  currentRecipeId: string | null
}

export interface JarRecipeSequence {
  physicalJarId: string
  recipeIds: string[]
}

export interface MinimumJarSwitchSequencePlan {
  minimumSwitches: number
  sequences: JarRecipeSequence[]
}

/**
 * Exact physical sequence planner for newly produced recipe types.
 *
 * A queue gets one switch-free first recipe when its current type already
 * matches that recipe or the physical jar is currently empty. Every later
 * distinct recipe on the same jar costs one type switch.
 *
 * Recipes with terminal leftovers must be the final type on their physical
 * jar. If a terminal recipe is also used as the switch-free first type, that
 * jar is dedicated to the terminal recipe; otherwise switching away and back
 * would add an avoidable extra switch.
 */
export function planMinimumJarTypeSwitchSequences(
  jars: readonly ReusableJarSwitchState[],
  recipeIds: readonly string[],
  terminalRecipeIds: readonly string[] = [],
): MinimumJarSwitchSequencePlan {
  const uniqueRecipeIds = [...new Set(recipeIds)]
  const recipeSet = new Set(uniqueRecipeIds)
  const terminalSet = new Set(
    terminalRecipeIds.filter((recipeId) => recipeSet.has(recipeId)),
  )

  if (uniqueRecipeIds.length === 0) {
    return {
      minimumSwitches: 0,
      sequences: jars.map((jar) => ({
        physicalJarId: jar.physicalJarId,
        recipeIds: [],
      })),
    }
  }
  if (jars.length === 0) {
    throw new Error(
      'At least one reusable physical jar is required for produced recipes',
    )
  }
  if (terminalSet.size > jars.length) {
    throw new Error(
      'Terminal recipe count exceeds reusable physical jar count',
    )
  }

  const sortedJars = [...jars].sort((a, b) =>
    a.physicalJarId.localeCompare(b.physicalJarId),
  )
  const sequenceByJarId = new Map(
    sortedJars.map((jar) => [jar.physicalJarId, [] as string[]]),
  )
  const freeFirstRecipeByJarId = new Map<string, string>()
  const usedFreeRecipeIds = new Set<string>()

  // Preserve exact current-type matches first. Duplicate jars carrying the
  // same type cannot create more than one free first use for that recipe.
  const currentRecipeOrder = [
    ...uniqueRecipeIds.filter((recipeId) => !terminalSet.has(recipeId)),
    ...uniqueRecipeIds.filter((recipeId) => terminalSet.has(recipeId)),
  ]
  for (const recipeId of currentRecipeOrder) {
    const jar = sortedJars.find(
      (candidate) =>
        !freeFirstRecipeByJarId.has(candidate.physicalJarId) &&
        candidate.currentRecipeId === recipeId,
    )
    if (!jar) continue

    freeFirstRecipeByJarId.set(jar.physicalJarId, recipeId)
    usedFreeRecipeIds.add(recipeId)
  }

  // Empty jars may take any first type without a switch. Prefer non-terminal
  // recipes so terminal recipes can remain at the end of a mixed sequence.
  const unmatchedRecipeOrder = [
    ...uniqueRecipeIds.filter(
      (recipeId) =>
        !usedFreeRecipeIds.has(recipeId) &&
        !terminalSet.has(recipeId),
    ),
    ...uniqueRecipeIds.filter(
      (recipeId) =>
        !usedFreeRecipeIds.has(recipeId) &&
        terminalSet.has(recipeId),
    ),
  ]
  const emptyJars = sortedJars.filter(
    (jar) =>
      !freeFirstRecipeByJarId.has(jar.physicalJarId) &&
      jar.currentRecipeId === null,
  )
  for (const jar of emptyJars) {
    const recipeId = unmatchedRecipeOrder.shift()
    if (!recipeId) break
    freeFirstRecipeByJarId.set(jar.physicalJarId, recipeId)
    usedFreeRecipeIds.add(recipeId)
  }

  const nonTerminalRecipeIds = uniqueRecipeIds.filter(
    (recipeId) => !terminalSet.has(recipeId),
  )

  // Pathological case: every reusable jar is currently matched to a terminal
  // recipe, while some non-terminal recipe still has to be produced. One
  // terminal match must give up its free first position so the jar can run
  // non-terminal work before returning to that terminal type.
  const freeTerminalJarIds = sortedJars
    .filter((jar) => {
      const recipeId = freeFirstRecipeByJarId.get(jar.physicalJarId)
      return recipeId ? terminalSet.has(recipeId) : false
    })
    .map((jar) => jar.physicalJarId)
  const unmatchedNonTerminalExists = nonTerminalRecipeIds.some(
    (recipeId) => !usedFreeRecipeIds.has(recipeId),
  )
  if (
    unmatchedNonTerminalExists &&
    freeTerminalJarIds.length === sortedJars.length
  ) {
    const jarId = freeTerminalJarIds[0]
    const recipeId = freeFirstRecipeByJarId.get(jarId)
    if (!recipeId) {
      throw new Error('Terminal free-start bookkeeping drifted')
    }
    freeFirstRecipeByJarId.delete(jarId)
    usedFreeRecipeIds.delete(recipeId)
  }

  for (const jar of sortedJars) {
    const first = freeFirstRecipeByJarId.get(jar.physicalJarId)
    if (first) {
      sequenceByJarId.get(jar.physicalJarId)?.push(first)
    }
  }

  const dedicatedTerminalJarIds = new Set(
    sortedJars.flatMap((jar) => {
      const first = freeFirstRecipeByJarId.get(jar.physicalJarId)
      return first && terminalSet.has(first)
        ? [jar.physicalJarId]
        : []
    }),
  )
  const nonDedicatedJars = sortedJars.filter(
    (jar) => !dedicatedTerminalJarIds.has(jar.physicalJarId),
  )
  if (
    nonDedicatedJars.length === 0 &&
    uniqueRecipeIds.some((recipeId) => !usedFreeRecipeIds.has(recipeId))
  ) {
    throw new Error(
      'No reusable physical jar can host the remaining recipe sequence',
    )
  }

  const unmatchedNonTerminalRecipeIds = nonTerminalRecipeIds.filter(
    (recipeId) => !usedFreeRecipeIds.has(recipeId),
  )

  // Secondary objective: distribute non-terminal work across otherwise unused
  // jars before stacking more types onto an already active sequence. This
  // keeps trip parallelism without changing the exact minimum switch count.
  for (const recipeId of unmatchedNonTerminalRecipeIds) {
    const target = [...nonDedicatedJars].sort((a, b) => {
      const aLength = sequenceByJarId.get(a.physicalJarId)?.length ?? 0
      const bLength = sequenceByJarId.get(b.physicalJarId)?.length ?? 0
      return (
        aLength - bLength ||
        a.physicalJarId.localeCompare(b.physicalJarId)
      )
    })[0]
    if (!target) {
      throw new Error(
        'No reusable physical jar can host a non-terminal recipe',
      )
    }
    sequenceByJarId.get(target.physicalJarId)?.push(recipeId)
  }

  const alreadyPlacedTerminalIds = new Set(
    [...freeFirstRecipeByJarId.values()].filter((recipeId) =>
      terminalSet.has(recipeId),
    ),
  )
  const remainingTerminalRecipeIds = uniqueRecipeIds.filter(
    (recipeId) =>
      terminalSet.has(recipeId) &&
      !alreadyPlacedTerminalIds.has(recipeId),
  )
  const terminalTargetPool = [...nonDedicatedJars]

  for (const recipeId of remainingTerminalRecipeIds) {
    const target = terminalTargetPool
      .sort((a, b) => {
        const aLength =
          sequenceByJarId.get(a.physicalJarId)?.length ?? 0
        const bLength =
          sequenceByJarId.get(b.physicalJarId)?.length ?? 0
        return (
          aLength - bLength ||
          a.physicalJarId.localeCompare(b.physicalJarId)
        )
      })
      .shift()
    if (!target) {
      throw new Error(
        'Terminal recipe allocation exceeded reusable physical jar count',
      )
    }
    sequenceByJarId.get(target.physicalJarId)?.push(recipeId)
  }

  const sequences = sortedJars.map((jar) => ({
    physicalJarId: jar.physicalJarId,
    recipeIds: sequenceByJarId.get(jar.physicalJarId) ?? [],
  }))
  const placedRecipeIds = sequences.flatMap(
    (sequence) => sequence.recipeIds,
  )

  if (
    placedRecipeIds.length !== uniqueRecipeIds.length ||
    new Set(placedRecipeIds).size !== uniqueRecipeIds.length
  ) {
    throw new Error(
      'Minimum jar-switch sequence plan did not place every recipe exactly once',
    )
  }

  for (const sequence of sequences) {
    const terminalPositions = sequence.recipeIds
      .map((recipeId, index) =>
        terminalSet.has(recipeId) ? index : -1,
      )
      .filter((index) => index >= 0)
    if (
      terminalPositions.length > 1 ||
      (
        terminalPositions.length === 1 &&
        terminalPositions[0] !== sequence.recipeIds.length - 1
      )
    ) {
      throw new Error(
        'Terminal recipe must be the final type on its physical jar',
      )
    }
  }

  return {
    minimumSwitches:
      uniqueRecipeIds.length - freeFirstRecipeByJarId.size,
    sequences,
  }
}
