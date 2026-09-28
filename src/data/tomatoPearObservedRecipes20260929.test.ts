import { describe, expect, it } from 'vitest'
import { evaluateRecipeSequence } from '../domain/recipeEvaluator'
import { recipes } from './recipes'

const observedBatch = [
  {
    id: 'tomato-pear-blend',
    ingredientIds: ['tomato', 'pear'],
    ingredients: ['番茄', '梨'],
    observedDisplayName: '番茄 - 梨（調製飲品）',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 30,
    effects: [
      { name: '保護心臟', value: 7 },
      { name: '促進消化', value: 4 },
      { name: '煥亮肌膚', value: 2 },
    ],
    equipment: ['榨汁機', '果汁調和器', '果汁成品台'],
  },
  {
    id: 'tomato-pear-peach-blend',
    ingredientIds: ['tomato', 'pear', 'peach'],
    ingredients: ['番茄', '梨', '桃子'],
    observedDisplayName: '助消 繁榮',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 55,
    effects: [
      { name: '促進消化', value: 8 },
      { name: '保護心臟', value: 8 },
      { name: '舒緩呼吸', value: 3 },
      { name: '煥亮肌膚', value: 2 },
    ],
    equipment: ['榨汁機', '果汁調和器', '果汁成品台'],
  },
] as const

describe('2026-09-29 observed tomato pear recipes', () => {
  it('stores both direct screenshot observations', () => {
    for (const observation of observedBatch) {
      expect(recipes.find((recipe) => recipe.id === observation.id)).toMatchObject({
        id: observation.id,
        ingredients: observation.ingredients,
        observedDisplayName: observation.observedDisplayName,
        unlockedAt: observation.unlockedAt,
        salePrice: observation.salePrice,
        effects: observation.effects,
        equipment: observation.equipment,
      })
    }
  })

  it('resolves both sequences through observed authority with the fruit Blender', () => {
    for (const observation of observedBatch) {
      const result = evaluateRecipeSequence(
        [...observation.ingredientIds],
        observation.unlockedAt,
      )

      expect(result.valid).toBe(true)
      if (!result.valid) continue

      expect(result.candidate).toMatchObject({
        id: observation.id,
        source: 'observed',
        observedDisplayName: observation.observedDisplayName,
        salePrice: observation.salePrice,
        effects: observation.effects,
        equipment: observation.equipment,
      })
      expect(result.availableAtCurrentProgress).toBe(true)
      expect(result.usesBlender).toBe(true)
    }
  })

  it('keeps the two 55-gold permutations as distinct observed identities', () => {
    const pearThenPeach = evaluateRecipeSequence(
      ['tomato', 'pear', 'peach'],
      'ibex-statue-unlocked',
    )
    const peachThenPear = evaluateRecipeSequence(
      ['tomato', 'peach', 'pear'],
      'ibex-statue-unlocked',
    )

    expect(pearThenPeach.valid).toBe(true)
    expect(peachThenPear.valid).toBe(true)
    if (!pearThenPeach.valid || !peachThenPear.valid) return

    expect(pearThenPeach.candidate).toMatchObject({
      id: 'tomato-pear-peach-blend',
      observedDisplayName: '助消 繁榮',
      salePrice: 55,
    })
    expect(peachThenPear.candidate).toMatchObject({
      id: 'tomato-peach-pear-blend',
      observedDisplayName: '助消 勇氣',
      salePrice: 55,
    })
    expect(pearThenPeach.candidate.id).not.toBe(peachThenPear.candidate.id)
  })
})
