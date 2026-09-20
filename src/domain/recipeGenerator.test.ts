import { describe, expect, it } from 'vitest'
import { ingredients } from '../data/ingredients'
import {
  effectSlotCount,
  generateRecipeCandidates,
  predictRecipeEffects,
} from './recipeGenerator'

function ingredient(name: string) {
  const found = ingredients.find((item) => item.name === name)
  if (!found) throw new Error(`Missing fixture ingredient: ${name}`)
  return found
}

describe('recipe generator', () => {
  it.each([
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 5],
  ])('uses %s unique ingredients -> %s effect slots', (count, expected) => {
    expect(effectSlotCount(count)).toBe(expected)
  })

  it('accumulates duplicate effect names across ingredients without relying on a tie-break', () => {
    const result = predictRecipeEffects([
      ingredient('檸檬'),
      ingredient('梨'),
    ])

    expect(result.effectAmbiguity).toBeUndefined()
    expect(result.effects).toEqual(
      expect.arrayContaining([
        { name: '保護心臟', value: 4 },
        { name: '酸味', value: 4 },
        { name: '促進消化', value: 4 },
      ]),
    )
  })

  it('returns an exact computed prediction when the cutoff is unique', () => {
    const result = predictRecipeEffects([
      ingredient('橙子'),
      ingredient('糖'),
    ])

    expect(result.effectAmbiguity).toBeUndefined()
    expect(result.effects).toEqual([
      { name: '甜味', value: 5 },
      { name: '增強免疫', value: 4 },
      { name: '補充精力', value: 3 },
    ])
  })

  it('keeps unresolved cutoff ties explicit instead of inventing a tie-break', () => {
    const result = predictRecipeEffects([
      ingredient('檸檬'),
      ingredient('薄荷'),
    ])

    expect(result.effects).toEqual([
      { name: '清新口氣', value: 4 },
      { name: '酸味', value: 4 },
    ])
    expect(result.effectAmbiguity).toMatchObject({
      cutoffValue: 3,
      remainingSlots: 1,
    })
    expect(result.effectAmbiguity?.candidates).toEqual(
      expect.arrayContaining([
        { name: '增強免疫', value: 3 },
        { name: '舒緩腸胃', value: 3 },
      ]),
    )
  })

  it('uses observed recipes as exact overlays for known sequences', () => {
    const candidates = generateRecipeCandidates('seasoner-unlocked')
    const lemonMint = candidates.find(
      (candidate) => candidate.ingredients.join(' → ') === '檸檬 → 薄荷',
    )

    expect(lemonMint).toMatchObject({
      source: 'observed',
      salePrice: 28,
    })
    expect(lemonMint?.effectAmbiguity).toBeUndefined()
    expect(lemonMint?.effects).toEqual([
      { name: '清新口氣', value: 4 },
      { name: '酸味', value: 4 },
      { name: '舒緩腸胃', value: 3 },
    ])
  })

  it('keeps observed three-ingredient seasoning order as separate identities', () => {
    const candidates = generateRecipeCandidates('seasoner-unlocked')
    const sugarMint = candidates.find(
      (candidate) =>
        candidate.ingredients.join(' → ') === '橙子 → 糖 → 薄荷',
    )
    const mintSugar = candidates.find(
      (candidate) =>
        candidate.ingredients.join(' → ') === '橙子 → 薄荷 → 糖',
    )

    expect(sugarMint?.source).toBe('observed')
    expect(mintSugar?.source).toBe('observed')
    expect(sugarMint?.effects).not.toEqual(mintSugar?.effects)
  })

  it('does not expose tranquil-fountain ingredients before their milestone', () => {
    const candidates = generateRecipeCandidates('juicer-unlocked')
    const allIngredients = candidates.flatMap((candidate) => candidate.ingredients)

    expect(allIngredients).not.toContain('香蕉')
    expect(allIngredients).not.toContain('肉桂')
  })

  it('adds banana bases and cinnamon seasoning after tranquil fountain unlocks', () => {
    const candidates = generateRecipeCandidates('tranquil-fountain-unlocked')

    expect(
      candidates.some(
        (candidate) => candidate.ingredients.join(' → ') === '香蕉',
      ),
    ).toBe(true)
    expect(
      candidates.some(
        (candidate) => candidate.ingredients.join(' → ') === '香蕉 → 肉桂',
      ),
    ).toBe(true)
  })

  it('never generates two juice bases as a pre-blender seasoning recipe', () => {
    const candidates = generateRecipeCandidates('tranquil-fountain-unlocked')
    const sequences = candidates.map((candidate) => candidate.ingredients.join(' → '))

    expect(sequences).not.toContain('香蕉 → 梨')
    expect(sequences).not.toContain('梨 → 香蕉')
    expect(sequences).not.toContain('檸檬 → 橙子')
  })

  it('uses at most three unique ingredients and never repeats seasoning in v1', () => {
    const candidates = generateRecipeCandidates('tranquil-fountain-unlocked')

    for (const candidate of candidates) {
      expect(candidate.ingredients.length).toBeLessThanOrEqual(3)
      expect(new Set(candidate.ingredients).size).toBe(candidate.ingredients.length)
    }
  })

  it('keeps all pre-fountain valid sequences on observed data', () => {
    const seasonerCandidates = generateRecipeCandidates('seasoner-unlocked')
    const juicerCandidates = generateRecipeCandidates('juicer-unlocked')

    expect(seasonerCandidates).toHaveLength(10)
    expect(juicerCandidates).toHaveLength(20)
    expect(seasonerCandidates.every((candidate) => candidate.source === 'observed')).toBe(true)
    expect(juicerCandidates.every((candidate) => candidate.source === 'observed')).toBe(true)
  })

  it('does not invent juice-blender combinations when stage five unlocks', () => {
    const beforeBlender = generateRecipeCandidates('tranquil-fountain-unlocked')
      .map((candidate) => candidate.ingredients.join(' → '))
      .sort()
    const afterBlender = generateRecipeCandidates('juice-blender-unlocked')
      .map((candidate) => candidate.ingredients.join(' → '))
      .sort()

    expect(afterBlender).toEqual(beforeBlender)
  })

  it('never invents a sale price for computed candidates', () => {
    const candidates = generateRecipeCandidates('tranquil-fountain-unlocked')
    const bananaCinnamon = candidates.find(
      (candidate) => candidate.ingredients.join(' → ') === '香蕉 → 肉桂',
    )

    expect(bananaCinnamon?.source).toBe('computed')
    expect(bananaCinnamon?.salePrice).toBeNull()
  })
})
