import { describe, expect, it } from 'vitest'
import {
  combineRecipeSequences,
  evaluateRecipeSequence,
  predictRecipeEffects,
} from './recipeEvaluator'
import { ingredients } from '../data/ingredients'

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

  it('returns observed tranquil-fountain data for a newly synced sequence', () => {
    const result = evaluateRecipeSequence(
      ['banana', 'cinnamon'],
      'tranquil-fountain-unlocked',
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.candidate).toMatchObject({
      id: 'banana-cinnamon',
      source: 'observed',
      salePrice: 37,
      ingredients: ['香蕉', '肉桂'],
      effects: [
        { name: '調節血糖', value: 4 },
        { name: '補充精力', value: 4 },
        { name: '紓解壓力', value: 3 },
      ],
    })
    expect(result.cost).toMatchObject({
      batchIngredientCost: 31,
      unitIngredientCost: 15.5,
    })
  })

  it('uses the observed three-ingredient overlay instead of a computed prediction', () => {
    const result = evaluateRecipeSequence(
      ['banana', 'cinnamon', 'mint'],
      'tranquil-fountain-unlocked',
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.candidate).toMatchObject({
      id: 'banana-cinnamon-mint',
      source: 'observed',
      salePrice: 58,
      effects: [
        { name: '清新口氣', value: 4 },
        { name: '紓解壓力', value: 4 },
        { name: '調節血糖', value: 4 },
        { name: '補充精力', value: 4 },
      ],
    })
    expect(result.candidate.effectAmbiguity).toBeUndefined()
  })

  it('returns computed data only when no observed overlay exists', () => {
    const result = evaluateRecipeSequence(
      ['banana', 'sugar'],
      'tranquil-fountain-unlocked',
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.candidate.source).toBe('computed')
    expect(result.candidate.salePrice).toBeNull()
    expect(result.candidate.ingredients).toEqual(['香蕉', '糖'])
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


  const blenderObservations = [
    {
      ingredientIds: ['lemon', 'orange'],
      id: 'lemon-orange-blend',
      observedDisplayName: '檸檬－橙子（調製飲品）',
      salePrice: 24,
      effects: [
        { name: '增強免疫', value: 7 },
        { name: '酸味', value: 4 },
        { name: '煥亮肌膚', value: 2 },
      ],
    },
    {
      ingredientIds: ['lemon', 'carrot', 'mint', 'sugar'],
      id: 'lemon-carrot-mint-sugar-blend',
      observedDisplayName: '甜味 敬意',
      salePrice: 56,
      effects: [
        { name: '甜味', value: 5 },
        { name: '清新口氣', value: 4 },
        { name: '改善視力', value: 4 },
        { name: '增強免疫', value: 4 },
        { name: '酸味', value: 4 },
      ],
    },
    {
      ingredientIds: ['lemon', 'carrot', 'mint', 'sugar', 'pear'],
      id: 'lemon-carrot-mint-sugar-pear-blend',
      observedDisplayName: '甜味 衝擊',
      salePrice: 80,
      effects: [
        { name: '甜味', value: 5 },
        { name: '促進消化', value: 4 },
        { name: '保護心臟', value: 4 },
        { name: '清新口氣', value: 4 },
        { name: '改善視力', value: 4 },
      ],
    },
    {
      ingredientIds: ['lemon', 'sugar', 'mint', 'orange', 'mint', 'sugar'],
      id: 'lemon-sugar-mint-orange-mint-sugar-blend',
      observedDisplayName: '甜味 非凡',
      salePrice: 57,
      effects: [
        { name: '甜味', value: 10 },
        { name: '清新口氣', value: 8 },
        { name: '增強免疫', value: 7 },
        { name: '補充精力', value: 6 },
        { name: '舒緩腸胃', value: 6 },
      ],
    },
  ] as const

  for (const observation of blenderObservations) {
    it(`uses the exact observed blender overlay for ${observation.ingredientIds.join(' > ')}`, () => {
      const result = evaluateRecipeSequence(
        [...observation.ingredientIds],
        'juice-blender-unlocked',
      )

      expect(result.valid).toBe(true)
      if (!result.valid) return

      expect(result.candidate).toMatchObject({
        id: observation.id,
        source: 'observed',
        observedDisplayName: observation.observedDisplayName,
        salePrice: observation.salePrice,
        effects: observation.effects,
      })
      expect(result.usesBlender).toBe(true)
      expect(result.availableAtCurrentProgress).toBe(true)
    })
  }

  it('matches observed blender effects with the general ordered-sequence model', () => {
    const ingredientById = new Map(
      ingredients.map((ingredient) => [ingredient.id, ingredient]),
    )

    for (const observation of blenderObservations) {
      const sequence = observation.ingredientIds.map((ingredientId) => {
        const ingredient = ingredientById.get(ingredientId)
        if (!ingredient) {
          throw new Error(`Missing ingredient fixture: ${ingredientId}`)
        }
        return ingredient
      })
      const prediction = predictRecipeEffects(sequence)

      expect(prediction.effectAmbiguity).toBeUndefined()
      expect(prediction.effects).toEqual(observation.effects)
    }
  })
})
