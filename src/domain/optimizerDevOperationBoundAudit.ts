/**
 * Dev-only structural audit of Candidate B's machine-operation stage.
 * Does not construct, relax or solve a HiGHS model and is not proof of an
 * optimal objective or a usable assignment/production witness.
 *
 * This mirrors buildHighsStage's recipe/customer-capacity and edge-quantity
 * upper-bound logic when tightenRecipeBoundsFromCustomerCapacity and
 * tightenOperationBoundsFromRecipeBounds are enabled, and there is no fixed
 * minimum-cost objective (Candidate B's post-maximum-ingredient-cost stage).
 * The independent productionCostFix equality can only tighten feasible values;
 * this audit does not rely on that equality.
 * It must be reviewed alongside the solver if those conditions change.
 */

type ProductionKind = 'juicing' | 'seasoning' | 'blending' | 'finalizing'

type BoundDomain = {
  serviceableCustomerIds: readonly string[]
  recipes: readonly {
    eligibleCustomerIds: readonly string[]
    maxProductionUnits?: number
    productionPath: {
      edges: readonly { key: string; kind: ProductionKind }[]
    }
  }[]
}

type BoundBucket = 'zero' | 'one' | 'twoToStackCapacity' | 'overStackCapacity'

type KindCounts = Record<ProductionKind, number>

export interface DevOperationBoundAudit {
  selectedStage: 'post-maximum-ingredient-cost-machine-operations'
  serviceableCustomers: number
  recipes: number
  operationEdges: number
  processingStackCapacity: number
  quantityUpperBoundBuckets: Record<BoundBucket, number>
  operationEdgesByKind: KindCounts
  substitutableEdgesByKind: KindCounts
  /** q <= 1 => op=q under original q<=stack*op, op<=q, integer op. */
  structurallySubstitutableEdges: number
  /** Edges with q_upper=1; unlike q_upper=0 these need a nontrivial substitution. */
  nontrivialSubstitutionCandidates: number
  /** These are opportunities for a separate, gated reformulation, NOT removed variables. */
  unchangedOperationVariables: number
  maxEdgeQuantityUpperBound: number
}

const kinds: readonly ProductionKind[] = [
  'juicing', 'seasoning', 'blending', 'finalizing',
]

function zeroKindCounts(): KindCounts {
  return { juicing: 0, seasoning: 0, blending: 0, finalizing: 0 }
}

export function auditCandidateBOperationBounds(
  domain: BoundDomain,
  processingStackCapacity: number,
): DevOperationBoundAudit {
  if (!Number.isSafeInteger(processingStackCapacity) || processingStackCapacity < 1) {
    throw new Error('Invalid processing stack capacity for operation audit')
  }

  const maxJuiceUnitsPerRecipe = Math.max(
    1,
    Math.ceil(domain.serviceableCustomerIds.length / 2),
  )
  const upperBoundByEdgeKey = new Map<string, { kind: ProductionKind; units: number }>()

  for (const recipe of domain.recipes) {
    // Matches current Candidate B buildHighsStage's tightened recipe upper bound.
    const customerCapacityUpperBound = Math.max(
      1,
      Math.ceil(recipe.eligibleCustomerIds.length / 2),
    )
    const computedRecipeUpperBound = Math.min(
      maxJuiceUnitsPerRecipe,
      customerCapacityUpperBound,
    )
    const recipeUpperBound = Math.min(
      computedRecipeUpperBound,
      recipe.maxProductionUnits === undefined
        ? computedRecipeUpperBound
        : Math.max(0, Math.floor(recipe.maxProductionUnits)),
    )

    // Count repeated use of one edge *within* a single recipe, as the solver does.
    const edgeMultiplicity = new Map<string, { kind: ProductionKind; count: number }>()
    for (const edge of recipe.productionPath.edges) {
      const previous = edgeMultiplicity.get(edge.key)
      if (previous && previous.kind !== edge.kind) {
        throw new Error(`Production edge ${edge.key} changed kind in one recipe`)
      }
      edgeMultiplicity.set(edge.key, {
        kind: edge.kind,
        count: (previous?.count ?? 0) + 1,
      })
    }
    for (const [key, { kind, count }] of edgeMultiplicity) {
      const previous = upperBoundByEdgeKey.get(key)
      if (previous && previous.kind !== kind) {
        throw new Error(`Production edge ${key} changed kind across recipes`)
      }
      upperBoundByEdgeKey.set(key, {
        kind,
        units: (previous?.units ?? 0) + count * recipeUpperBound,
      })
    }
  }

  const quantityUpperBoundBuckets: Record<BoundBucket, number> = {
    zero: 0,
    one: 0,
    twoToStackCapacity: 0,
    overStackCapacity: 0,
  }
  const operationEdgesByKind = zeroKindCounts()
  const substitutableEdgesByKind = zeroKindCounts()
  let maxEdgeQuantityUpperBound = 0
  let structurallySubstitutableEdges = 0

  for (const { kind, units } of upperBoundByEdgeKey.values()) {
    if (!kinds.includes(kind)) {
      throw new Error('Unknown operation kind in structural audit')
    }
    operationEdgesByKind[kind] += 1
    maxEdgeQuantityUpperBound = Math.max(maxEdgeQuantityUpperBound, units)
    if (units <= 1) {
      quantityUpperBoundBuckets[units === 0 ? 'zero' : 'one'] += 1
      substitutableEdgesByKind[kind] += 1
      structurallySubstitutableEdges += 1
    } else if (units <= processingStackCapacity) {
      quantityUpperBoundBuckets.twoToStackCapacity += 1
    } else {
      quantityUpperBoundBuckets.overStackCapacity += 1
    }
  }

  return {
    selectedStage: 'post-maximum-ingredient-cost-machine-operations',
    serviceableCustomers: domain.serviceableCustomerIds.length,
    recipes: domain.recipes.length,
    operationEdges: upperBoundByEdgeKey.size,
    processingStackCapacity,
    quantityUpperBoundBuckets,
    operationEdgesByKind,
    substitutableEdgesByKind,
    structurallySubstitutableEdges,
    nontrivialSubstitutionCandidates: quantityUpperBoundBuckets.one,
    unchangedOperationVariables: upperBoundByEdgeKey.size,
    maxEdgeQuantityUpperBound,
  }
}
