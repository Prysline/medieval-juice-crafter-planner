import { describe, expect, it } from 'vitest'
import { ingredients } from './ingredients'
import {
  progressMilestoneIds,
  progressMilestoneIndex,
  progressMilestoneLabels,
} from './progress'
import { villages } from './villages'
import {
  ingredientIsAvailable,
  villageIsAvailable,
} from '../domain/availability'

describe('Stage 8 progress milestone', () => {
  it('is a selectable progression point after the Stage 7 ibex milestone', () => {
    expect(progressMilestoneIds.at(-1)).toBe(
      'sales-assistant-adam-arrived',
    )
    expect(
      progressMilestoneIndex.get('sales-assistant-adam-arrived'),
    ).toBeGreaterThan(
      progressMilestoneIndex.get('ibex-statue-unlocked')!,
    )
    expect(
      progressMilestoneLabels['sales-assistant-adam-arrived'],
    ).toBe('階段八｜售飲助手 Adam 已抵達')
  })

  it('does not unlock additional current runtime content by itself', () => {
    const ingredientIdsAtIbex = ingredients
      .filter((ingredient) =>
        ingredientIsAvailable(ingredient, 'ibex-statue-unlocked'),
      )
      .map((ingredient) => ingredient.id)
    const ingredientIdsAtAdam = ingredients
      .filter((ingredient) =>
        ingredientIsAvailable(
          ingredient,
          'sales-assistant-adam-arrived',
        ),
      )
      .map((ingredient) => ingredient.id)

    const villageIdsAtIbex = villages
      .filter((village) =>
        villageIsAvailable(village.id, 'ibex-statue-unlocked'),
      )
      .map((village) => village.id)
    const villageIdsAtAdam = villages
      .filter((village) =>
        villageIsAvailable(
          village.id,
          'sales-assistant-adam-arrived',
        ),
      )
      .map((village) => village.id)

    expect(ingredientIdsAtAdam).toEqual(ingredientIdsAtIbex)
    expect(villageIdsAtAdam).toEqual(villageIdsAtIbex)
  })
})
