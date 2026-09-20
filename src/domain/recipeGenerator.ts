import { ingredientIsAvailable } from './availability'
import {
  effectSlotCount,
  evaluateRecipeSequence,
  predictRecipeEffects,
} from './recipeEvaluator'
import { ingredients } from '../data/ingredients'
import {
  recipeIngredientCapabilities,
  type RecipeIngredientCapability,
} from '../data/recipeIngredientCapabilities'
import type {
  Ingredient,
  ProgressMilestoneId,
  RecipeCandidate,
} from '../types'

const ingredientById = new Map(
  ingredients.map((ingredient) => [ingredient.id, ingredient]),
)

function capabilityIngredient(
  capability: RecipeIngredientCapability,
): Ingredient {
  const ingredient = ingredientById.get(capability.ingredientId)
  if (!ingredient) {
    throw new Error(
      `Missing ingredient for recipe capability: ${capability.ingredientId}`,
    )
  }
  return ingredient
}

function evaluatedCandidate(
  ingredientIds: string[],
  currentProgress: ProgressMilestoneId,
): RecipeCandidate {
  const evaluation = evaluateRecipeSequence(ingredientIds, currentProgress)
  if (!evaluation.valid) {
    throw new Error(
      `Generator produced invalid sequence: ${ingredientIds.join(' -> ')}`,
    )
  }
  return evaluation.candidate
}

export { effectSlotCount, predictRecipeEffects }

export function generateRecipeCandidates(
  currentProgress: ProgressMilestoneId,
): RecipeCandidate[] {
  const availableCapabilities = recipeIngredientCapabilities.filter(
    (capability) =>
      ingredientIsAvailable(
        capabilityIngredient(capability),
        currentProgress,
      ),
  )
  const bases = availableCapabilities.filter((capability) =>
    capability.roles.includes('juice-base'),
  )
  const seasonings = availableCapabilities.filter((capability) =>
    capability.roles.includes('seasoning'),
  )

  const result: RecipeCandidate[] = []

  for (const base of bases) {
    result.push(
      evaluatedCandidate([base.ingredientId], currentProgress),
    )

    for (const firstSeasoning of seasonings) {
      result.push(
        evaluatedCandidate(
          [base.ingredientId, firstSeasoning.ingredientId],
          currentProgress,
        ),
      )

      for (const secondSeasoning of seasonings) {
        if (
          secondSeasoning.ingredientId === firstSeasoning.ingredientId
        ) {
          continue
        }

        result.push(
          evaluatedCandidate(
            [
              base.ingredientId,
              firstSeasoning.ingredientId,
              secondSeasoning.ingredientId,
            ],
            currentProgress,
          ),
        )
      }
    }
  }

  return result
}
