import { describe, expect, it } from 'vitest'
import { recipeResearchObservations } from './recipeResearch'
import { recipes } from './recipes'

function uniqueIngredientKey(values: string[]): string {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'zh-Hant')).join('|')
}

function recipeById(id: string) {
  const recipe = recipes.find((item) => item.id === id)
  if (!recipe) throw new Error(`Missing recipe fixture: ${id}`)
  return recipe
}

describe('recipe research invariants', () => {
  it('keeps observed order variants at the same sale price for the same unique ingredient set', () => {
    const pairs = [
      ['orange-sugar-mint', 'orange-mint-sugar'],
      ['lemon-sugar-mint', 'lemon-mint-sugar'],
      ['pear-sugar-mint', 'pear-mint-sugar'],
      ['carrot-sugar-mint', 'carrot-mint-sugar'],
    ] as const

    for (const [leftId, rightId] of pairs) {
      const left = recipeById(leftId)
      const right = recipeById(rightId)

      expect(uniqueIngredientKey(left.ingredients)).toBe(
        uniqueIngredientKey(right.ingredients),
      )
      expect(left.salePrice).toBe(right.salePrice)
    }
  })

  it('keeps repeated existing ingredients from increasing the observed sale price', () => {
    const canonicalKey = uniqueIngredientKey(['橙子', '糖', '薄荷'])
    const matchingObservations = recipeResearchObservations.filter(
      (observation) =>
        uniqueIngredientKey(observation.ingredients) === canonicalKey,
    )

    expect(matchingObservations.length).toBeGreaterThanOrEqual(4)
    for (const observation of matchingObservations) {
      expect(observation.salePrice).toBe(42)
    }
  })

  it('stores the four new tranquil-fountain screenshots as canonical observed recipes', () => {
    expect(recipeById('banana-cinnamon')).toMatchObject({
      observedDisplayName: '香蕉－肉桂（調製飲品）',
      salePrice: 37,
      ingredients: ['香蕉', '肉桂'],
      effects: [
        { name: '調節血糖', value: 4 },
        { name: '補充精力', value: 4 },
        { name: '紓解壓力', value: 3 },
      ],
    })
    expect(recipeById('orange-cinnamon')).toMatchObject({
      observedDisplayName: '橙子－肉桂（調製飲品）',
      salePrice: 32,
      ingredients: ['橙子', '肉桂'],
    })
    expect(recipeById('banana-cinnamon-mint')).toMatchObject({
      observedDisplayName: '清口 奢華',
      salePrice: 58,
      ingredients: ['香蕉', '肉桂', '薄荷'],
    })
    expect(recipeById('orange-cinnamon-mint')).toMatchObject({
      observedDisplayName: '清口 希望',
      salePrice: 53,
      ingredients: ['橙子', '肉桂', '薄荷'],
    })
  })
})
