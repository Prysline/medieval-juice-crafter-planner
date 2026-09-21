import { describe, expect, it } from 'vitest'
import {
  combineRecipeSequences,
  evaluateRecipeSequence,
} from './recipeEvaluator'

describe('recipe sequence evaluator', () => {
  it('returns observed data for an observed sequence', () => {
    const result = evaluateRecipeSequence(
      ['lemon', 'mint'],
      'seasoner-unlocked',
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.candidate.source).toBe('observed')
    expect(result.candidate.name).toBe('檸檬 - 薄荷（調製飲品）')
    expect(result.candidate.salePrice).toBe(28)
    expect(result.candidate.effects).toEqual([
      { name: '清新口氣', value: 4 },
      { name: '酸味', value: 4 },
      { name: '舒緩腸胃', value: 3 },
    ])
    expect(result.cost).toMatchObject({
      batchIngredientCost: 23,
      unitIngredientCost: 11.5,
    })
  })

  it('returns computed data only when no observed overlay exists', () => {
    const result = evaluateRecipeSequence(
      ['banana', 'cinnamon'],
      'tranquil-fountain-unlocked',
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.candidate.source).toBe('computed')
    expect(result.candidate.salePrice).toBeNull()
    expect(result.candidate.ingredients).toEqual(['香蕉', '肉桂'])
    expect(result.cost).toMatchObject({
      batchIngredientCost: 31,
      unitIngredientCost: 15.5,
    })
  })

  it('preserves seasoning order as recipe identity', () => {
    const sugarMint = evaluateRecipeSequence(
      ['orange', 'sugar', 'mint'],
      'seasoner-unlocked',
    )
    const mintSugar = evaluateRecipeSequence(
      ['orange', 'mint', 'sugar'],
      'seasoner-unlocked',
    )

    expect(sugarMint.valid).toBe(true)
    expect(mintSugar.valid).toBe(true)
    if (!sugarMint.valid || !mintSugar.valid) return

    expect(sugarMint.candidate.id).not.toBe(mintSugar.candidate.id)
    expect(sugarMint.candidate.effects).not.toEqual(
      mintSugar.candidate.effects,
    )
  })

  it('treats a second juice base as a blender segment', () => {
    const result = evaluateRecipeSequence(
      ['banana', 'pear'],
      'juice-blender-unlocked',
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.candidate.source).toBe('computed')
    expect(result.drinkSegmentCount).toBe(2)
    expect(result.usesBlender).toBe(true)
    expect(result.candidate.unlockedAt).toBe('juice-blender-unlocked')
    expect(result.candidate.equipment).toContain('果汁調和器')
  })

  it('keeps a blender sequence evaluable before unlock but marks it unavailable', () => {
    const result = evaluateRecipeSequence(
      ['lemon', 'sugar', 'orange', 'mint'],
      'tranquil-fountain-unlocked',
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.ingredientIds).toEqual([
      'lemon',
      'sugar',
      'orange',
      'mint',
    ])
    expect(result.usesBlender).toBe(true)
    expect(result.availableAtCurrentProgress).toBe(false)
    expect(result.candidate.unlockedAt).toBe('juice-blender-unlocked')
  })

  it('allows repeated seasonings and sequences longer than generator v1', () => {
    const repeated = evaluateRecipeSequence(
      ['orange', 'sugar', 'sugar'],
      'seasoner-unlocked',
    )
    const long = evaluateRecipeSequence(
      ['orange', 'sugar', 'mint', 'cinnamon'],
      'tranquil-fountain-unlocked',
    )

    expect(repeated.valid).toBe(true)
    expect(long.valid).toBe(true)

    if (repeated.valid) {
      expect(repeated.candidate.ingredients).toEqual([
        '橙子',
        '糖',
        '糖',
      ])
      expect(repeated.cost.batchIngredientCost).toBe(25)
    }
    if (long.valid) {
      expect(long.candidate.ingredients).toEqual([
        '橙子',
        '糖',
        '薄荷',
        '肉桂',
      ])
    }
  })

  it('concatenates front and back drink sequences without rewriting order', () => {
    expect(
      combineRecipeSequences(
        ['lemon', 'sugar'],
        ['orange', 'mint'],
      ),
    ).toEqual([
      'lemon',
      'sugar',
      'orange',
      'mint',
    ])
  })

  it('still requires the overall sequence to start from a juice base', () => {
    const result = evaluateRecipeSequence(
      ['sugar', 'lemon'],
      'juice-blender-unlocked',
    )

    expect(result.valid).toBe(false)
    if (result.valid) return

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-base' }),
      ]),
    )
  })

  it('keeps a valid saved sequence evaluable when current progress is earlier', () => {
    const result = evaluateRecipeSequence(
      ['banana', 'cinnamon'],
      'juicer-unlocked',
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.availableAtCurrentProgress).toBe(false)
    expect(result.candidate.unlockedAt).toBe('tranquil-fountain-unlocked')
  })
})
