import { isAvailableAtProgress } from './availability'
import { calculateRecipeIngredientCost } from './recipeCost'
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

function latestUnlock(sequence: Ingredient[]): ProgressMilestoneId {
  return sequence.reduce<ProgressMilestoneId>((latest, ingredient) => {
    const latestIndex = progressMilestoneIndex.get(latest) ?? -1
    const ingredientIndex =
      progressMilestoneIndex.get(ingredient.unlockedAt) ?? -1
    return ingredientIndex > latestIndex ? ingredient.unlockedAt : latest
  }, 'opening')
}

export function effectSlotCount(uniqueIngredientCount: number): number {
  return Math.min(5, uniqueIngredientCount + 1)
}

export function predictRecipeEffects(sequence: Ingredient[]): {
  effects: EffectValue[]
  effectAmbiguity?: RecipeCandidate['effectAmbiguity']
} {
  const totals = new Map<string, number>()

  for (const ingredient of sequence) {
    for (const effect of ingredient.effects) {
      totals.set(effect.name, (totals.get(effect.name) ?? 0) + effect.value)
    }
  }

  const ranked = [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort(
      (a, b) =>
        b.value - a.value ||
        a.name.localeCompare(b.name, 'zh-Hant'),
    )

  const slotCount = effectSlotCount(
    new Set(sequence.map((item) => item.id)).size,
  )
  if (ranked.length <= slotCount) {
    return { effects: ranked }
  }

  const cutoffValue = ranked[slotCount - 1]?.value
  if (cutoffValue === undefined) {
    return { effects: ranked }
  }

  const guaranteed = ranked.filter((effect) => effect.value > cutoffValue)
  const tiedAtCutoff = ranked.filter((effect) => effect.value === cutoffValue)
  const remainingSlots = slotCount - guaranteed.length

  if (tiedAtCutoff.length <= remainingSlots) {
    return { effects: [...guaranteed, ...tiedAtCutoff] }
  }

  return {
    effects: guaranteed,
    effectAmbiguity: {
      cutoffValue,
      remainingSlots,
      candidates: tiedAtCutoff,
    },
  }
}

function equipmentForSequence(
  baseCapability: RecipeIngredientCapability,
  sequenceLength: number,
): string[] {
  if (!baseCapability.baseEquipment) {
    throw new Error(
      `Juice base missing equipment: ${baseCapability.ingredientId}`,
    )
  }

  return [
    baseCapability.baseEquipment,
    ...(sequenceLength > 1 ? ['調味器'] : []),
    '果汁成品台',
  ]
}

function observedCandidate(recipe: Recipe): RecipeCandidate {
  return {
    id: recipe.id,
    name: recipe.name,
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
  baseCapability: RecipeIngredientCapability,
): RecipeCandidate {
  const prediction = predictRecipeEffects(sequence)
  const ingredientNames = sequence.map((ingredient) => ingredient.name)

  return {
    id: `computed:${sequence.map((ingredient) => ingredient.id).join('+')}`,
    name: `預測（${ingredientNames.join(' → ')}）`,
    source: 'computed',
    unlockedAt: latestUnlock(sequence),
    salePrice: null,
    ingredients: ingredientNames,
    effects: prediction.effects,
    effectAmbiguity: prediction.effectAmbiguity,
    equipment: equipmentForSequence(baseCapability, sequence.length),
  }
}

function validateRecipeSequence(
  ingredientIds: string[],
): {
  issues: RecipeSequenceIssue[]
  ingredients: Ingredient[]
  baseCapability: RecipeIngredientCapability | null
} {
  const issues: RecipeSequenceIssue[] = []

  if (ingredientIds.length === 0) {
    issues.push({
      code: 'empty',
      message: '請先選擇一種果汁基底。',
    })
  }

  if (ingredientIds.length > 3) {
    issues.push({
      code: 'too-many-ingredients',
      message: '目前正式模擬器最多支援三種不重複原料。',
    })
  }

  const seen = new Set<string>()
  for (const id of ingredientIds) {
    if (seen.has(id)) {
      issues.push({
        code: 'duplicate-ingredient',
        ingredientId: id,
        message: '目前正式模擬器不支援重複加入同一原料。',
      })
    }
    seen.add(id)
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
  }

  const firstId = ingredientIds[0]
  const baseCapability = firstId
    ? capabilityByIngredientId.get(firstId) ?? null
    : null

  if (
    firstId &&
    (!baseCapability || !baseCapability.roles.includes('juice-base'))
  ) {
    issues.push({
      code: 'invalid-base',
      ingredientId: firstId,
      message: '第一個原料必須是目前已確認可製成果汁基底的原料。',
    })
  }

  for (const id of ingredientIds.slice(1)) {
    const capability = capabilityByIngredientId.get(id)
    if (!capability || !capability.roles.includes('seasoning')) {
      issues.push({
        code: 'invalid-seasoning',
        ingredientId: id,
        message: '第二、三個原料目前只允許已確認的調味材料。',
      })
    }
  }

  return {
    issues,
    ingredients: sequence,
    baseCapability,
  }
}

export function evaluateRecipeSequence(
  ingredientIds: string[],
  currentProgress: ProgressMilestoneId,
): RecipeSequenceEvaluation {
  const normalizedIds = [...ingredientIds]
  const validation = validateRecipeSequence(normalizedIds)

  if (
    validation.issues.length > 0 ||
    !validation.baseCapability ||
    validation.ingredients.length !== normalizedIds.length
  ) {
    return {
      valid: false,
      ingredientIds: normalizedIds,
      issues: validation.issues,
    }
  }

  const observed = observedRecipeByIdSequence.get(sequenceKey(normalizedIds))
  const candidate = observed
    ? observedCandidate(observed)
    : computedCandidate(validation.ingredients, validation.baseCapability)

  return {
    valid: true,
    ingredientIds: normalizedIds,
    candidate,
    cost: calculateRecipeIngredientCost(candidate),
    availableAtCurrentProgress: isAvailableAtProgress(
      candidate.unlockedAt,
      currentProgress,
    ),
  }
}
