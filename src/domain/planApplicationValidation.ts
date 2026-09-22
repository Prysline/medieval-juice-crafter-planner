import type { PlanApplicationBasisState, PlanApplicationTransactionDraft } from './planApplicationTransaction'

export type PlanApplicationBasisMismatchField =
  | 'inventory'
  | 'current-progress'
  | 'satisfaction'
  | 'formal-customers'
  | 'supplied-customers'
  | 'planner-settings'

export interface PlanApplicationBasisValidation {
  readonly valid: boolean
  readonly stale: boolean
  readonly mismatches: readonly PlanApplicationBasisMismatchField[]
}

function sameStringRecord(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const aEntries = Object.entries(a).sort(([aKey], [bKey]) =>
    aKey.localeCompare(bKey),
  )
  const bEntries = Object.entries(b).sort(([aKey], [bKey]) =>
    aKey.localeCompare(bKey),
  )

  return (
    aEntries.length === bEntries.length &&
    aEntries.every(
      ([key, value], index) =>
        bEntries[index]?.[0] === key &&
        bEntries[index]?.[1] === value,
    )
  )
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  const aSorted = [...new Set(a)].sort()
  const bSorted = [...new Set(b)].sort()

  return (
    aSorted.length === bSorted.length &&
    aSorted.every((value, index) => value === bSorted[index])
  )
}

function sameOrderedStrings(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return (
    a.length === b.length &&
    a.every((value, index) => value === b[index])
  )
}

function sameInventory(
  draft: PlanApplicationTransactionDraft['before']['inventory'],
  current: PlanApplicationBasisState['inventory'],
): boolean {
  return (
    sameStringRecord(draft.ingredientUnits, current.ingredientUnits) &&
    draft.waterUnits === current.waterUnits &&
    draft.cleanCups === current.cleanCups &&
    draft.usedCups === current.usedCups &&
    draft.shelfCount === current.shelfCount &&
    draft.jarRackCount === current.jarRackCount &&
    draft.juiceJars.length === current.juiceJars.length &&
    draft.juiceJars.every((jar, index) => {
      const currentJar = current.juiceJars[index]
      return (
        currentJar?.id === jar.id &&
        currentJar.recipeId === jar.recipeId &&
        currentJar.servings === jar.servings
      )
    })
  )
}

function sameSatisfaction(
  draft: PlanApplicationTransactionDraft['before']['satisfactionByVillage'],
  current: PlanApplicationBasisState['satisfactionByVillage'],
): boolean {
  return (
    draft['east-harbor'] === current['east-harbor'] &&
    draft['tranquil-fountain'] === current['tranquil-fountain']
  )
}

function samePlannerSettings(
  draft: PlanApplicationTransactionDraft['before']['plannerSettings'],
  current: PlanApplicationBasisState['plannerSettings'],
): boolean {
  return (
    draft.allowUsedCupDropIfFull ===
      current.allowUsedCupDropIfFull &&
    draft.allowDiscardRetainedJuice ===
      current.allowDiscardRetainedJuice &&
    draft.juiceJarCarryMode === current.juiceJarCarryMode &&
    draft.reservedJuiceJarSlots ===
      current.reservedJuiceJarSlots
  )
}

export function validatePlanApplicationTransactionBasis(
  draft: PlanApplicationTransactionDraft,
  current: PlanApplicationBasisState,
): PlanApplicationBasisValidation {
  const mismatches: PlanApplicationBasisMismatchField[] = []

  if (!sameInventory(draft.before.inventory, current.inventory)) {
    mismatches.push('inventory')
  }

  if (draft.before.currentProgress !== current.currentProgress) {
    mismatches.push('current-progress')
  }

  if (
    !sameSatisfaction(
      draft.before.satisfactionByVillage,
      current.satisfactionByVillage,
    )
  ) {
    mismatches.push('satisfaction')
  }

  if (
    !sameStringSet(
      draft.before.formalCustomerIds,
      current.formalCustomerIds,
    )
  ) {
    mismatches.push('formal-customers')
  }

  if (
    !sameStringSet(
      draft.before.suppliedCustomerIds,
      current.suppliedCustomerIds,
    )
  ) {
    mismatches.push('supplied-customers')
  }

  if (
    !samePlannerSettings(
      draft.before.plannerSettings,
      current.plannerSettings,
    )
  ) {
    mismatches.push('planner-settings')
  }

  const frozenMismatches = Object.freeze([...mismatches])
  return Object.freeze({
    valid: frozenMismatches.length === 0,
    stale: frozenMismatches.length > 0,
    mismatches: frozenMismatches,
  })
}
