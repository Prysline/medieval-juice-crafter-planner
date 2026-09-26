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

  it('preserves full pre-cutoff effect totals separately from observed output effects', () => {
    const result = evaluateRecipeSequence(
      ['lemon'],
      'opening',
    )

    expect(result.valid).toBe(true)
    if (!result.valid) return

    expect(result.candidate.effects).toEqual([
      { name: '酸味', value: 4 },
      { name: '增強免疫', value: 3 },
    ])
    expect(result.effectTotals).toEqual([
      { name: '酸味', value: 4 },
      { name: '增強免疫', value: 3 },
      { name: '保護心臟', value: 1 },
      { name: '輔助瘦身', value: 1 },
    ])
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

  it('uses the 2026-09-23 observed overlays for exact ordered sequences', () => {
    const observations = [
      {
        ingredientIds: ['banana', 'mint'],
        id: 'banana-mint',
        observedDisplayName: '香蕉 - 薄荷（調製飲品）',
        salePrice: 35,
      },
      {
        ingredientIds: ['lemon', 'sugar', 'cinnamon'],
        id: 'lemon-sugar-cinnamon',
        observedDisplayName: '甜味 咆哮',
        salePrice: 42,
      },
      {
        ingredientIds: ['banana', 'mint', 'sugar'],
        id: 'banana-mint-sugar',
        observedDisplayName: '活力 戀人',
        salePrice: 47,
      },
      {
        ingredientIds: ['pear', 'mint', 'sugar', 'cinnamon'],
        id: 'pear-mint-sugar-cinnamon',
        observedDisplayName: '甜味 暴風',
        salePrice: 70,
      },
      {
        ingredientIds: ['orange', 'sugar', 'mint', 'cinnamon'],
        id: 'orange-sugar-mint-cinnamon',
        observedDisplayName: '甜味 滋響',
        salePrice: 67,
      },
      {
        ingredientIds: ['carrot', 'mint', 'sugar', 'cinnamon'],
        id: 'carrot-mint-sugar-cinnamon',
        observedDisplayName: '血糖平衡 勇士',
        salePrice: 66,
      },
      {
        ingredientIds: ['banana', 'mint', 'sugar', 'cinnamon'],
        id: 'banana-mint-sugar-cinnamon',
        observedDisplayName: '活力 純真',
        salePrice: 73,
      },
    ] as const

    for (const observation of observations) {
      const result = evaluateRecipeSequence(
        [...observation.ingredientIds],
        'tranquil-fountain-unlocked',
      )

      expect(result.valid).toBe(true)
      if (!result.valid) continue

      expect(result.candidate).toMatchObject({
        id: observation.id,
        source: 'observed',
        observedDisplayName: observation.observedDisplayName,
        salePrice: observation.salePrice,
      })
      expect(result.availableAtCurrentProgress).toBe(true)
      expect(result.usesBlender).toBe(false)
    }
  })

  it('uses the 2026-09-25 observed overlays for carrot/lemon with cinnamon', () => {
    const observations = [
      {
        ingredientIds: ['carrot', 'cinnamon'],
        id: 'carrot-cinnamon',
        observedDisplayName: '紅蘿蔔 - 肉桂（調製飲品）',
        salePrice: 31,
        effects: [
          { name: '調節血糖', value: 7 },
          { name: '改善視力', value: 4 },
          { name: '輔助瘦身', value: 2 },
        ],
      },
      {
        ingredientIds: ['lemon', 'cinnamon'],
        id: 'lemon-cinnamon',
        observedDisplayName: '檸檬 - 肉桂（調製飲品）',
        salePrice: 30,
        effects: [
          { name: '調節血糖', value: 4 },
          { name: '酸味', value: 4 },
          { name: '輔助瘦身', value: 3 },
        ],
      },
    ] as const

    for (const observation of observations) {
      const result = evaluateRecipeSequence(
        [...observation.ingredientIds],
        'tranquil-fountain-unlocked',
      )

      expect(result.valid).toBe(true)
      if (!result.valid) continue

      expect(result.candidate).toMatchObject({
        id: observation.id,
        source: 'observed',
        observedDisplayName: observation.observedDisplayName,
        salePrice: observation.salePrice,
        effects: observation.effects,
      })
      expect(result.availableAtCurrentProgress).toBe(true)
      expect(result.usesBlender).toBe(false)
    }
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

  it('uses ordered ingredient ids as the stable computed persistence identity', () => {
    const first = evaluateRecipeSequence(
      ['banana', 'sugar'],
      'tranquil-fountain-unlocked',
    )
    const second = evaluateRecipeSequence(
      ['banana', 'sugar'],
      'juice-blender-unlocked',
    )

    expect(first.valid).toBe(true)
    expect(second.valid).toBe(true)
    if (!first.valid || !second.valid) return

    expect(first.candidate.id).toBe('computed:banana+sugar')
    expect(second.candidate.id).toBe('computed:banana+sugar')
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
      ingredientIds: ['carrot', 'cinnamon', 'banana'],
      id: 'carrot-cinnamon-banana-blend',
      observedDisplayName: '血糖平衡 極樂',
      salePrice: 53,
      effects: [
        { name: '調節血糖', value: 7 },
        { name: '補充精力', value: 4 },
        { name: '改善視力', value: 4 },
        { name: '紓解壓力', value: 3 },
      ],
    },
    {
      ingredientIds: ['banana', 'cinnamon', 'orange', 'mint'],
      id: 'banana-cinnamon-orange-mint-blend',
      observedDisplayName: '清口 刺激',
      salePrice: 78,
      effects: [
        { name: '清新口氣', value: 4 },
        { name: '芳香', value: 4 },
        { name: '紓解壓力', value: 4 },
        { name: '增強免疫', value: 4 },
        { name: '調節血糖', value: 4 },
      ],
    },
    {
      ingredientIds: ['lemon', 'cinnamon', 'orange', 'mint'],
      id: 'lemon-cinnamon-orange-mint-blend',
      observedDisplayName: '免疫 繁榮',
      salePrice: 70,
      effects: [
        { name: '增強免疫', value: 7 },
        { name: '清新口氣', value: 4 },
        { name: '芳香', value: 4 },
        { name: '調節血糖', value: 4 },
        { name: '酸味', value: 4 },
      ],
    },
    {
      ingredientIds: ['orange', 'banana', 'lemon', 'sugar'],
      id: 'orange-banana-lemon-sugar-blend',
      observedDisplayName: '活力 水晶',
      salePrice: 59,
      effects: [
        { name: '補充精力', value: 7 },
        { name: '增強免疫', value: 7 },
        { name: '甜味', value: 6 },
        { name: '酸味', value: 4 },
        { name: '紓解壓力', value: 3 },
      ],
    },
    {
      ingredientIds: ['banana', 'cinnamon', 'orange', 'mint', 'lemon'],
      id: 'banana-cinnamon-orange-mint-lemon-blend',
      observedDisplayName: '免疫 爆炎',
      salePrice: 98,
      effects: [
        { name: '增強免疫', value: 7 },
        { name: '酸味', value: 4 },
        { name: '清新口氣', value: 4 },
        { name: '芳香', value: 4 },
        { name: '紓解壓力', value: 4 },
      ],
    },
    {
      ingredientIds: ['carrot', 'cinnamon', 'banana', 'pear', 'mint'],
      id: 'carrot-cinnamon-banana-pear-mint-blend',
      observedDisplayName: '血糖平衡 夜幕',
      salePrice: 102,
      effects: [
        { name: '調節血糖', value: 7 },
        { name: '促進消化', value: 5 },
        { name: '清新口氣', value: 4 },
        { name: '紓解壓力', value: 4 },
        { name: '保護心臟', value: 4 },
      ],
    },
    {
      ingredientIds: ['orange', 'orange'],
      id: 'orange-orange-blend',
      observedDisplayName: '橙子 - 橙子（調製飲品）',
      salePrice: 12,
      effects: [
        { name: '增強免疫', value: 8 },
        { name: '煥亮肌膚', value: 4 },
      ],
    },
    {
      ingredientIds: ['orange', 'orange', 'carrot', 'cinnamon'],
      id: 'orange-orange-carrot-cinnamon-blend',
      observedDisplayName: '免疫 摯友',
      salePrice: 48,
      effects: [
        { name: '增強免疫', value: 9 },
        { name: '調節血糖', value: 7 },
        { name: '改善視力', value: 4 },
        { name: '煥亮肌膚', value: 4 },
      ],
    },
    {
      ingredientIds: ['carrot', 'cinnamon', 'orange'],
      id: 'carrot-cinnamon-orange-blend',
      observedDisplayName: '血糖平衡 衝擊',
      salePrice: 48,
      effects: [
        { name: '調節血糖', value: 7 },
        { name: '增強免疫', value: 5 },
        { name: '改善視力', value: 4 },
        { name: '煥亮肌膚', value: 2 },
      ],
    },
    {
      ingredientIds: ['carrot', 'cinnamon', 'orange', 'orange'],
      id: 'carrot-cinnamon-orange-orange-blend',
      observedDisplayName: '免疫 純真',
      salePrice: 48,
      effects: [
        { name: '增強免疫', value: 9 },
        { name: '調節血糖', value: 7 },
        { name: '煥亮肌膚', value: 4 },
        { name: '改善視力', value: 4 },
      ],
    },
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
      ingredientIds: ['orange', 'banana'],
      id: 'orange-banana-blend',
      observedDisplayName: '橙子 - 香蕉（調製飲品）',
      salePrice: 31,
      effects: [
        { name: '補充精力', value: 4 },
        { name: '增強免疫', value: 4 },
        { name: '紓解壓力', value: 3 },
      ],
    },
    {
      ingredientIds: ['pear', 'banana'],
      id: 'pear-banana-blend',
      observedDisplayName: '梨 - 香蕉（調製飲品）',
      salePrice: 34,
      effects: [
        { name: '促進消化', value: 5 },
        { name: '補充精力', value: 4 },
        { name: '紓解壓力', value: 3 },
      ],
    },
    {
      ingredientIds: ['pear', 'carrot'],
      id: 'pear-carrot-blend',
      observedDisplayName: '梨 - 紅蘿蔔（調製飲品）',
      salePrice: 28,
      effects: [
        { name: '改善視力', value: 4 },
        { name: '促進消化', value: 4 },
        { name: '調節血糖', value: 3 },
      ],
    },
    {
      ingredientIds: ['orange', 'banana', 'lemon'],
      id: 'orange-banana-lemon-blend',
      observedDisplayName: '免疫 爆裂',
      salePrice: 46,
      effects: [
        { name: '增強免疫', value: 7 },
        { name: '酸味', value: 4 },
        { name: '補充精力', value: 4 },
        { name: '紓解壓力', value: 3 },
      ],
    },
    {
      ingredientIds: ['pear', 'carrot', 'lemon'],
      id: 'pear-carrot-lemon-blend',
      observedDisplayName: '酸味 雷霆',
      salePrice: 42,
      effects: [
        { name: '酸味', value: 4 },
        { name: '增強免疫', value: 4 },
        { name: '保護心臟', value: 4 },
        { name: '改善視力', value: 4 },
      ],
    },
    {
      ingredientIds: ['pear', 'cinnamon', 'lemon'],
      id: 'pear-cinnamon-lemon-blend',
      observedDisplayName: '護心 光芒',
      salePrice: 49,
      effects: [
        { name: '保護心臟', value: 5 },
        { name: '酸味', value: 4 },
        { name: '輔助瘦身', value: 4 },
        { name: '調節血糖', value: 4 },
      ],
    },
    {
      ingredientIds: ['pear', 'banana', 'carrot', 'mint'],
      id: 'pear-banana-carrot-mint-blend',
      observedDisplayName: '助消 勇士',
      salePrice: 73,
      effects: [
        { name: '促進消化', value: 5 },
        { name: '清新口氣', value: 4 },
        { name: '紓解壓力', value: 4 },
        { name: '改善視力', value: 4 },
        { name: '補充精力', value: 4 },
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
      ingredientIds: ['orange', 'sugar', 'mint', 'cinnamon', 'pear'],
      id: 'orange-sugar-mint-cinnamon-pear-blend',
      observedDisplayName: '護心 暗影',
      salePrice: 92,
      effects: [
        { name: '保護心臟', value: 5 },
        { name: '甜味', value: 5 },
        { name: '促進消化', value: 4 },
        { name: '調節血糖', value: 4 },
        { name: '芳香', value: 4 },
      ],
    },
    {
      ingredientIds: ['lemon', 'sugar', 'orange', 'mint'],
      id: 'lemon-sugar-orange-mint-blend',
      observedDisplayName: '免疫 溫柔',
      salePrice: 57,
      effects: [
        { name: '增強免疫', value: 7 },
        { name: '甜味', value: 5 },
        { name: '清新口氣', value: 4 },
        { name: '酸味', value: 4 },
        { name: '舒緩腸胃', value: 3 },
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

  it('keeps observed blender effects compatible with the general ordered-sequence model', () => {
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

      expect(observation.effects).toEqual(
        expect.arrayContaining(prediction.effects),
      )

      if (!prediction.effectAmbiguity) {
        // The exact selected effect/value set can be confirmed even when the
        // game's secondary display ordering among tied effects is still unknown.
        expect(prediction.effects).toHaveLength(observation.effects.length)
        continue
      }

      const unresolvedObserved = observation.effects.filter(
        (observedEffect) =>
          !prediction.effects.some(
            (predictedEffect) =>
              predictedEffect.name === observedEffect.name &&
              predictedEffect.value === observedEffect.value,
          ),
      )

      expect(unresolvedObserved).toHaveLength(
        prediction.effectAmbiguity.remainingSlots,
      )
      for (const observedEffect of unresolvedObserved) {
        expect(prediction.effectAmbiguity.candidates).toContainEqual(
          observedEffect,
        )
      }
    }
  })
})
