import { describe, expect, it } from 'vitest'
import { ingredients } from './ingredients'
import { progressMilestoneIndex } from './progress'
import { recipeIngredientCapabilities } from './recipeIngredientCapabilities'
import { villages } from './villages'
import {
  ingredientIsAvailable,
  villageIsAvailable,
} from '../domain/availability'
import { evaluateRecipeSequence } from '../domain/recipeEvaluator'
import { generateUniqueRecipeCandidateLayers } from '../domain/recipeGenerator'
import { normalizeSatisfactionByVillageIds } from '../storage/plannerState'

const ibexIngredientIds = ['peach', 'cucumber', 'tomato', 'clove'] as const

describe('Stage 7 ibex statue runtime data', () => {
  it('models ibex statue as the Stage 7 region milestone after the advanced citrus juicer', () => {
    expect(
      progressMilestoneIndex.get('advanced-citrus-juicer-unlocked'),
    ).toBeLessThan(
      progressMilestoneIndex.get('ibex-statue-unlocked')!,
    )

    expect(
      villages.find((village) => village.id === 'ibex-statue'),
    ).toEqual({
      id: 'ibex-statue',
      name: '羱羊雕像',
      unlockedAt: 'ibex-statue-unlocked',
    })

    expect(
      villageIsAvailable(
        'ibex-statue',
        'advanced-citrus-juicer-unlocked',
      ),
    ).toBe(false)
    expect(
      villageIsAvailable('ibex-statue', 'ibex-statue-unlocked'),
    ).toBe(true)
  })

  it('unlocks the four confirmed general ingredients only at ibex statue', () => {
    const before = ingredients
      .filter((ingredient) =>
        ingredientIsAvailable(
          ingredient,
          'advanced-citrus-juicer-unlocked',
        ),
      )
      .map((ingredient) => ingredient.id)
    const after = ingredients
      .filter((ingredient) =>
        ingredientIsAvailable(
          ingredient,
          'ibex-statue-unlocked',
        ),
      )
      .map((ingredient) => ingredient.id)

    for (const ingredientId of ibexIngredientIds) {
      expect(before).not.toContain(ingredientId)
      expect(after).toContain(ingredientId)
    }

    expect(ingredients.find((ingredient) => ingredient.id === 'milk')).toBeUndefined()
  })

  it('keeps the synced ingredient facts exact', () => {
    expect(ingredients.find((ingredient) => ingredient.id === 'peach')).toMatchObject({
      name: '桃子',
      unlockedAt: 'ibex-statue-unlocked',
      buyPrice: 17,
      seller: '蔬果商茱莉婭',
      effects: [
        { name: '促進消化', value: 4 },
        { name: '舒緩呼吸', value: 2 },
        { name: '保護心臟', value: 1 },
      ],
    })
    expect(ingredients.find((ingredient) => ingredient.id === 'cucumber')).toMatchObject({
      name: '黃瓜',
      buyPrice: 13,
      seller: '蔬果商瑪莎',
    })
    expect(ingredients.find((ingredient) => ingredient.id === 'tomato')).toMatchObject({
      name: '番茄',
      buyPrice: 12,
      seller: '蔬果商瑪莎',
    })
    expect(ingredients.find((ingredient) => ingredient.id === 'clove')).toMatchObject({
      name: '丁香',
      buyPrice: 14,
      seller: '香料商人',
    })
  })

  it('adds only directly confirmed recipe capabilities', () => {
    for (const ingredientId of ['peach', 'cucumber', 'tomato']) {
      expect(
        recipeIngredientCapabilities.find(
          (capability) => capability.ingredientId === ingredientId,
        ),
      ).toEqual({
        ingredientId,
        roles: ['juice-base'],
        baseEquipment: '榨汁機',
      })
    }

    expect(
      recipeIngredientCapabilities.find(
        (capability) => capability.ingredientId === 'clove',
      ),
    ).toEqual({
      ingredientId: 'clove',
      roles: ['seasoning'],
    })

    const seasoned = evaluateRecipeSequence(
      ['lemon', 'clove'],
      'ibex-statue-unlocked',
    )
    expect(seasoned.valid).toBe(true)
    if (!seasoned.valid) return
    expect(seasoned.availableAtCurrentProgress).toBe(true)
    expect(seasoned.candidate.ingredients).toEqual(['檸檬', '丁香'])
    expect(seasoned.candidate.equipment).toContain('調味器')

    const cloveOnly = evaluateRecipeSequence(
      ['clove'],
      'ibex-statue-unlocked',
    )
    expect(cloveOnly.valid).toBe(false)
    if (cloveOnly.valid) return
    expect(cloveOnly.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-base',
          ingredientId: 'clove',
        }),
      ]),
    )
  })

  it('expands the generated base universe only after the new milestone', () => {
    const before = generateUniqueRecipeCandidateLayers(
      'advanced-citrus-juicer-unlocked',
    )[0]?.candidates.map((candidate) => candidate.ingredients[0])
    const afterLayers = generateUniqueRecipeCandidateLayers(
      'ibex-statue-unlocked',
    )
    const after = afterLayers[0]?.candidates.map(
      (candidate) => candidate.ingredients[0],
    )
    const beforeSeasonings = generateUniqueRecipeCandidateLayers(
      'advanced-citrus-juicer-unlocked',
    )[1]?.candidates.flatMap((candidate) => candidate.ingredients)
    const afterSeasonings = afterLayers[1]?.candidates.flatMap(
      (candidate) => candidate.ingredients,
    )

    expect(before).not.toEqual(
      expect.arrayContaining(['桃子', '黃瓜', '番茄']),
    )
    expect(after).toEqual(
      expect.arrayContaining(['桃子', '黃瓜', '番茄']),
    )
    expect(after).not.toContain('丁香')
    expect(beforeSeasonings).not.toContain('丁香')
    expect(afterSeasonings).toContain('丁香')
  })

  it('normalizes existing two-region satisfaction storage with the new canonical region', () => {
    expect(
      normalizeSatisfactionByVillageIds(
        villages.map((village) => village.id),
        {
          'east-harbor': 12,
          'tranquil-fountain': 34,
        },
      ),
    ).toEqual({
      'east-harbor': 12,
      'tranquil-fountain': 34,
      'ibex-statue': 0,
    })
  })
})
