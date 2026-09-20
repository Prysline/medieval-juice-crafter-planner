import { describe, expect, it } from 'vitest'
import { evaluateRecipeSequence } from './recipeEvaluator'

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

  it('rejects two juice bases instead of inferring blender rules', () => {
    const result = evaluateRecipeSequence(
      ['banana', 'pear'],
      'juice-blender-unlocked',
    )

    expect(result.valid).toBe(false)
    if (result.valid) return

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-seasoning' }),
      ]),
    )
  })

  it('rejects duplicate ingredients and sequences longer than v1', () => {
    const duplicate = evaluateRecipeSequence(
      ['orange', 'sugar', 'sugar'],
      'seasoner-unlocked',
    )
    const tooLong = evaluateRecipeSequence(
      ['orange', 'sugar', 'mint', 'cinnamon'],
      'tranquil-fountain-unlocked',
    )

    expect(duplicate.valid).toBe(false)
    expect(tooLong.valid).toBe(false)

    if (!duplicate.valid) {
      expect(duplicate.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'duplicate-ingredient' }),
        ]),
      )
    }
    if (!tooLong.valid) {
      expect(tooLong.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'too-many-ingredients' }),
        ]),
      )
    }
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
