import { ingredientIsAvailable } from './availability'
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
} from '../types'

function sequenceKey(values: string[]): string {
  return values.join('\u001f')
}

const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))
const observedRecipeBySequence = new Map(
  recipes.map((recipe) => [sequenceKey(recipe.ingredients), recipe]),
)

function capabilityIngredient(
  capability: RecipeIngredientCapability,
): Ingredient {
  const ingredient = ingredientById.get(capability.ingredientId)
  if (!ingredient) {
    throw new Error(`Missing ingredient for recipe capability: ${capability.ingredientId}`)
  }
  return ingredient
}

function latestUnlock(
  sequence: Ingredient[],
): ProgressMilestoneId {
  return sequence.reduce<ProgressMilestoneId>((latest, ingredient) => {
    const latestIndex = progressMilestoneIndex.get(latest) ?? -1
    const ingredientIndex = progressMilestoneIndex.get(ingredient.unlockedAt) ?? -1
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

  const slotCount = effectSlotCount(new Set(sequence.map((item) => item.id)).size)
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
    throw new Error(`Juice base missing equipment: ${baseCapability.ingredientId}`)
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

function candidateForSequence(
  sequence: Ingredient[],
  baseCapability: RecipeIngredientCapability,
): RecipeCandidate {
  const observed = observedRecipeBySequence.get(
    sequenceKey(sequence.map((ingredient) => ingredient.name)),
  )
  return observed ? observedCandidate(observed) : computedCandidate(sequence, baseCapability)
}

export function generateRecipeCandidates(
  currentProgress: ProgressMilestoneId,
): RecipeCandidate[] {
  const availableCapabilities = recipeIngredientCapabilities.filter((capability) =>
    ingredientIsAvailable(capabilityIngredient(capability), currentProgress),
  )
  const bases = availableCapabilities.filter((capability) =>
    capability.roles.includes('juice-base'),
  )
  const seasonings = availableCapabilities.filter((capability) =>
    capability.roles.includes('seasoning'),
  )

  const result: RecipeCandidate[] = []

  for (const baseCapability of bases) {
    const base = capabilityIngredient(baseCapability)
    result.push(candidateForSequence([base], baseCapability))

    for (const firstSeasoningCapability of seasonings) {
      const firstSeasoning = capabilityIngredient(firstSeasoningCapability)
      result.push(
        candidateForSequence([base, firstSeasoning], baseCapability),
      )

      for (const secondSeasoningCapability of seasonings) {
        if (secondSeasoningCapability.ingredientId === firstSeasoningCapability.ingredientId) {
          continue
        }
        const secondSeasoning = capabilityIngredient(secondSeasoningCapability)
        result.push(
          candidateForSequence(
            [base, firstSeasoning, secondSeasoning],
            baseCapability,
          ),
        )
      }
    }
  }

  return result
}
