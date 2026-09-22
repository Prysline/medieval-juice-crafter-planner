import { isAvailableAtProgress } from './availability'
import { calculateRecipeIngredientCost } from './recipeCost'
import { computedRecipeIdentity } from './recipeIdentity'
import { ingredients } from '../data/ingredients'
import { progressMilestoneIndex } from '../data/progress'
import {
  recipeIngredientCapabilities,
  type RecipeIngredientCapability,
} from '../data/recipeIngredientCapabilities'
import { recipes } from '../data/recipes'
import type {
  EffectValue,
  Ingredient,
  ProgressMilestoneId,
  Recipe,
  RecipeCandidate,
  RecipeSequenceEvaluation,
  RecipeSequenceIssue,
} from '../types'

function sequenceKey(values: string[]): string {
  return values.join('\u001f')
}

const ingredientById = new Map(
  ingredients.map((ingredient) => [ingredient.id, ingredient]),
)
const ingredientIdByName = new Map(
  ingredients.map((ingredient) => [ingredient.name, ingredient.id]),
)
const capabilityByIngredientId = new Map(
  recipeIngredientCapabilities.map((capability) => [
    capability.ingredientId,
    capability,
  ]),
)

const observedRecipeByIdSequence = new Map(
  recipes.flatMap((recipe) => {
    const ids = recipe.ingredients.map((name) => ingredientIdByName.get(name))
    return ids.every((id): id is string => Boolean(id))
      ? [[sequenceKey(ids), recipe] as const]
      : []
  }),
)

function laterMilestone(
  left: ProgressMilestoneId,
  right: ProgressMilestoneId,
): ProgressMilestoneId {
  const leftIndex = progressMilestoneIndex.get(left) ?? -1
  const rightIndex = progressMilestoneIndex.get(right) ?? -1
  return rightIndex > leftIndex ? right : left
}

function latestUnlock(
  sequence: Ingredient[],
  extras: ProgressMilestoneId[] = [],
): ProgressMilestoneId {
  return [
    ...sequence.map((ingredient) => ingredient.unlockedAt),
    ...extras,
  ].reduce<ProgressMilestoneId>(
    (latest, milestone) => laterMilestone(latest, milestone),
    'opening',
  )
}

export function effectSlotCount(uniqueIngredientCount: number): number {
  return Math.min(5, uniqueIngredientCount + 1)
}

interface RankedRecipeEffect extends EffectValue {
  lastContributionIndex: number
}

function rankRecipeEffects(sequence: Ingredient[]): RankedRecipeEffect[] {
  const totals = new Map<
    string,
    {
      value: number
      lastContributionIndex: number
    }
  >()

  sequence.forEach((ingredient, ingredientIndex) => {
    for (const effect of ingredient.effects) {
      const current = totals.get(effect.name)
      totals.set(effect.name, {
        value: (current?.value ?? 0) + effect.value,
        lastContributionIndex: ingredientIndex,
      })
    }
  })

  return [...totals.entries()]
    .map(([name, data]) => ({
      name,
      value: data.value,
      lastContributionIndex: data.lastContributionIndex,
    }))
    .sort(
      (a, b) =>
        b.value - a.value ||
        b.lastContributionIndex - a.lastContributionIndex ||
        a.name.localeCompare(b.name, 'zh-Hant'),
    )
}

export function calculateRecipeEffectTotals(
  sequence: Ingredient[],
): EffectValue[] {
  return rankRecipeEffects(sequence).map(({ name, value }) => ({
    name,
    value,
  }))
}

export function predictRecipeEffects(sequence: Ingredient[]): {
  effects: EffectValue[]
  effectAmbiguity?: RecipeCandidate['effectAmbiguity']
} {
  const ranked = rankRecipeEffects(sequence)

  const slotCount = effectSlotCount(
    new Set(sequence.map((item) => item.id)).size,
  )
  if (ranked.length <= slotCount) {
    return {
      effects: ranked.map(({ name, value }) => ({ name, value })),
    }
  }

  const cutoff = ranked[slotCount - 1]
  if (!cutoff) {
    return {
      effects: ranked.map(({ name, value }) => ({ name, value })),
    }
  }

  const outranksCutoff = ranked.filter(
    (effect) =>
      effect.value > cutoff.value ||
      (effect.value === cutoff.value &&
        effect.lastContributionIndex > cutoff.lastContributionIndex),
  )
  const tiedAtCutoff = ranked.filter(
    (effect) =>
      effect.value === cutoff.value &&
      effect.lastContributionIndex === cutoff.lastContributionIndex,
  )
  const remainingSlots = slotCount - outranksCutoff.length

  if (tiedAtCutoff.length <= remainingSlots) {
    return {
      effects: [...outranksCutoff, ...tiedAtCutoff].map(
        ({ name, value }) => ({ name, value }),
      ),
    }
  }

  return {
    effects: outranksCutoff.map(({ name, value }) => ({ name, value })),
    effectAmbiguity: {
      cutoffValue: cutoff.value,
      remainingSlots,
      candidates: tiedAtCutoff.map(({ name, value }) => ({
        name,
        value,
      })),
    },
  }
}

function sequenceCapabilities(
  ingredientIds: string[],
): RecipeIngredientCapability[] {
  return ingredientIds.flatMap((id) => {
    const capability = capabilityByIngredientId.get(id)
    return capability ? [capability] : []
  })
}

function equipmentForSequence(
  capabilities: RecipeIngredientCapability[],
): string[] {
  const result: string[] = []

  for (const capability of capabilities) {
    if (
      capability.roles.includes('juice-base') &&
      capability.baseEquipment &&
      !result.includes(capability.baseEquipment)
    ) {
      result.push(capability.baseEquipment)
    }
  }

  if (
    capabilities.some((capability) =>
      capability.roles.includes('seasoning'),
    )
  ) {
    result.push('調味器')
  }

  result.push('果汁成品台')

  const drinkSegmentCount = capabilities.filter((capability) =>
    capability.roles.includes('juice-base'),
  ).length
  if (drinkSegmentCount > 1) {
    result.push('果汁調和器')
  }

  return result
}

function observedCandidate(recipe: Recipe): RecipeCandidate {
  return {
    id: recipe.id,
    name: recipe.name,
    observedDisplayName: recipe.observedDisplayName,
    source: 'observed',
    unlockedAt: recipe.unlockedAt,
    salePrice: recipe.salePrice,
    ingredients: recipe.ingredients,
    effects: recipe.effects,
    equipment: recipe.equipment,
    observedRecipeId: recipe.id,
  }
}

function computedCandidate(
  sequence: Ingredient[],
  capabilities: RecipeIngredientCapability[],
): RecipeCandidate {
  const prediction = predictRecipeEffects(sequence)
  const ingredientNames = sequence.map((ingredient) => ingredient.name)
  const drinkSegmentCount = capabilities.filter((capability) =>
    capability.roles.includes('juice-base'),
  ).length

  return {
    id: computedRecipeIdentity(
      sequence.map((ingredient) => ingredient.id),
    ),
    name: `預測（${ingredientNames.join(' → ')}）`,
    source: 'computed',
    unlockedAt: latestUnlock(
      sequence,
      drinkSegmentCount > 1 ? ['juice-blender-unlocked'] : [],
    ),
    salePrice: null,
    ingredients: ingredientNames,
    effects: prediction.effects,
    effectAmbiguity: prediction.effectAmbiguity,
    equipment: equipmentForSequence(capabilities),
  }
}

function validateRecipeSequence(
  ingredientIds: string[],
): {
  issues: RecipeSequenceIssue[]
  ingredients: Ingredient[]
  capabilities: RecipeIngredientCapability[]
} {
  const issues: RecipeSequenceIssue[] = []

  if (ingredientIds.length === 0) {
    issues.push({
      code: 'empty',
      message: '請點選原料建立配方順序。',
    })
  }

  const sequence: Ingredient[] = []
  for (const id of ingredientIds) {
    const ingredient = ingredientById.get(id)
    if (!ingredient) {
      issues.push({
        code: 'unknown-ingredient',
        ingredientId: id,
        message: `未知原料：${id}`,
      })
      continue
    }

    sequence.push(ingredient)

    if (!capabilityByIngredientId.has(id)) {
      issues.push({
        code: 'unsupported-ingredient',
        ingredientId: id,
        message: `目前尚未建立「${ingredient.name}」的製作角色資料。`,
      })
    }
  }

  const capabilities = sequenceCapabilities(ingredientIds)
  const firstId = ingredientIds[0]
  const firstCapability = firstId
    ? capabilityByIngredientId.get(firstId)
    : undefined

  if (
    firstId &&
    (!firstCapability || !firstCapability.roles.includes('juice-base'))
  ) {
    issues.push({
      code: 'invalid-base',
      ingredientId: firstId,
      message: '配方順序必須從果汁基底開始。',
    })
  }

  return {
    issues,
    ingredients: sequence,
    capabilities,
  }
}

export function combineRecipeSequences(
  frontIngredientIds: string[],
  backIngredientIds: string[],
): string[] {
  return [...frontIngredientIds, ...backIngredientIds]
}

export function evaluateRecipeSequence(
  ingredientIds: string[],
  currentProgress: ProgressMilestoneId,
): RecipeSequenceEvaluation {
  const normalizedIds = [...ingredientIds]
  const validation = validateRecipeSequence(normalizedIds)

  if (
    validation.issues.length > 0 ||
    validation.ingredients.length !== normalizedIds.length ||
    validation.capabilities.length !== normalizedIds.length
  ) {
    return {
      valid: false,
      ingredientIds: normalizedIds,
      issues: validation.issues,
    }
  }

  const drinkSegmentCount = validation.capabilities.filter((capability) =>
    capability.roles.includes('juice-base'),
  ).length
  const usesBlender = drinkSegmentCount > 1
  const observed = observedRecipeByIdSequence.get(sequenceKey(normalizedIds))
  const candidate = observed
    ? observedCandidate(observed)
    : computedCandidate(validation.ingredients, validation.capabilities)

  return {
    valid: true,
    ingredientIds: normalizedIds,
    candidate,
    effectTotals: calculateRecipeEffectTotals(validation.ingredients),
    cost: calculateRecipeIngredientCost(candidate),
    availableAtCurrentProgress: isAvailableAtProgress(
      candidate.unlockedAt,
      currentProgress,
    ),
    drinkSegmentCount,
    usesBlender,
  }
}
