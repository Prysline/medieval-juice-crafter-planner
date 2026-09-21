import { ingredients } from '../data/ingredients'
import {
  recipeIngredientCapabilities,
  type RecipeIngredientCapability,
} from '../data/recipeIngredientCapabilities'
import type { RecipeCandidate } from '../types'
import { PROCESSING_STACK_CAPACITY } from './inventoryRules'

export type ProductionStepKind =
  | 'juicing'
  | 'seasoning'
  | 'blending'
  | 'finalizing'

export interface ProductionPathEdge {
  key: string
  kind: ProductionStepKind
  equipment:
    | '柑橘榨汁機'
    | '榨汁機'
    | '調味器'
    | '果汁調和器'
    | '果汁成品台'
  fromIngredientIds: string[]
  /** Blender 的第二個果汁 input；其他 step 不使用。 */
  secondaryFromIngredientIds?: string[]
  toIngredientIds: string[]
  addedIngredientId?: string
}

export interface RecipeProductionPath {
  ingredientIds: string[]
  edges: ProductionPathEdge[]
}

export interface ProductionRecipeInput {
  recipeId: string
  recipeName: string
  ingredientIds: string[]
  juiceUnits: number
  assignedServings: number
}

export interface ProductionStep extends ProductionPathEdge {
  quantity: number
  operationCount: number
  recipeIds: string[]
}

export interface MachineOperationSummary {
  total: number
  juicing: number
  seasoning: number
  finalizing: number
  blending: number
}

export interface ProductionPlan {
  steps: ProductionStep[]
  machineOperations: MachineOperationSummary
}

const ingredientIdByName = new Map(
  ingredients.map((ingredient) => [ingredient.name, ingredient.id]),
)

const capabilityByIngredientId = new Map<
  string,
  RecipeIngredientCapability
>(
  recipeIngredientCapabilities.map((capability) => [
    capability.ingredientId,
    capability,
  ]),
)

function sequenceKey(ids: string[]): string {
  return ids.join('>')
}

export function productionPathForIngredientIds(
  ingredientIds: string[],
): RecipeProductionPath | null {
  if (ingredientIds.length === 0) return null

  const segments: string[][] = []
  let currentSegment: string[] = []

  for (const ingredientId of ingredientIds) {
    const capability = capabilityByIngredientId.get(ingredientId)
    if (!capability) return null

    if (capability.roles.includes('juice-base')) {
      if (!capability.baseEquipment) return null
      if (currentSegment.length > 0) {
        segments.push(currentSegment)
      }
      currentSegment = [ingredientId]
      continue
    }

    if (
      currentSegment.length === 0 ||
      !capability.roles.includes('seasoning')
    ) {
      return null
    }
    currentSegment.push(ingredientId)
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment)
  }
  if (segments.length === 0) return null

  const edges: ProductionPathEdge[] = []

  for (const segment of segments) {
    const baseId = segment[0]
    const baseCapability = capabilityByIngredientId.get(baseId)
    if (!baseCapability?.baseEquipment) return null

    edges.push({
      key: `juice:${baseId}`,
      kind: 'juicing',
      equipment: baseCapability.baseEquipment,
      fromIngredientIds: [],
      toIngredientIds: [baseId],
      addedIngredientId: baseId,
    })

    const prefix = [baseId]
    for (const seasoningId of segment.slice(1)) {
      const fromIngredientIds = [...prefix]
      prefix.push(seasoningId)
      edges.push({
        key: `season:${sequenceKey(prefix)}`,
        kind: 'seasoning',
        equipment: '調味器',
        fromIngredientIds,
        toIngredientIds: [...prefix],
        addedIngredientId: seasoningId,
      })
    }
  }

  let combined = [...segments[0]]
  for (const segment of segments.slice(1)) {
    const front = [...combined]
    const back = [...segment]
    combined = [...front, ...back]
    edges.push({
      key: `blend:${sequenceKey(front)}+${sequenceKey(back)}`,
      kind: 'blending',
      equipment: '果汁調和器',
      fromIngredientIds: front,
      secondaryFromIngredientIds: back,
      toIngredientIds: [...combined],
    })
  }

  edges.push({
    key: `finish:${sequenceKey(combined)}`,
    kind: 'finalizing',
    equipment: '果汁成品台',
    fromIngredientIds: [...combined],
    toIngredientIds: [...combined],
  })

  return {
    ingredientIds: [...ingredientIds],
    edges,
  }
}

export function productionPathForCandidate(
  candidate: RecipeCandidate,
): RecipeProductionPath | null {
  const ingredientIds = candidate.ingredients.map((name) =>
    ingredientIdByName.get(name),
  )
  if (ingredientIds.some((id) => id === undefined)) return null

  return productionPathForIngredientIds(ingredientIds as string[])
}

export function buildProductionPlan(
  recipes: ProductionRecipeInput[],
): ProductionPlan {
  const stepByKey = new Map<
    string,
    {
      edge: ProductionPathEdge
      quantity: number
      recipeIds: Set<string>
    }
  >()

  for (const recipe of recipes) {
    if (recipe.juiceUnits <= 0) continue

    const path = productionPathForIngredientIds(recipe.ingredientIds)
    if (!path) {
      throw new Error(
        `Unsupported production path for recipe ${recipe.recipeId}`,
      )
    }

    for (const edge of path.edges) {
      const current = stepByKey.get(edge.key) ?? {
        edge,
        quantity: 0,
        recipeIds: new Set<string>(),
      }
      current.quantity += recipe.juiceUnits
      current.recipeIds.add(recipe.recipeId)
      stepByKey.set(edge.key, current)
    }
  }

  const steps = [...stepByKey.values()]
    .map(({ edge, quantity, recipeIds }): ProductionStep => ({
      ...edge,
      quantity,
      operationCount: Math.ceil(quantity / PROCESSING_STACK_CAPACITY),
      recipeIds: [...recipeIds].sort(),
    }))
    .sort((a, b) => {
      const kindOrder: Record<ProductionStepKind, number> = {
        juicing: 0,
        seasoning: 1,
        blending: 2,
        finalizing: 3,
      }
      return (
        kindOrder[a.kind] - kindOrder[b.kind] ||
        a.toIngredientIds.length - b.toIngredientIds.length ||
        a.key.localeCompare(b.key)
      )
    })

  const summary: MachineOperationSummary = {
    total: 0,
    juicing: 0,
    seasoning: 0,
    finalizing: 0,
    blending: 0,
  }

  for (const step of steps) {
    summary.total += step.operationCount
    summary[step.kind] += step.operationCount
  }

  return {
    steps,
    machineOperations: summary,
  }
}
