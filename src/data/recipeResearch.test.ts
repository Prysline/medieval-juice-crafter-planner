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

  it('stores the 2026-09-23 observed recipe batch as canonical observed recipes', () => {
    const observations = [
      {
        id: 'banana-mint',
        observedDisplayName: '香蕉 - 薄荷（調製飲品）',
        salePrice: 35,
        ingredients: ['香蕉', '薄荷'],
        effects: [
          { name: '清新口氣', value: 4 },
          { name: '紓解壓力', value: 4 },
          { name: '補充精力', value: 4 },
        ],
      },
      {
        id: 'lemon-sugar-cinnamon',
        observedDisplayName: '甜味 咆哮',
        salePrice: 42,
        ingredients: ['檸檬', '糖', '肉桂'],
        effects: [
          { name: '甜味', value: 5 },
          { name: '調節血糖', value: 4 },
          { name: '酸味', value: 4 },
          { name: '輔助瘦身', value: 3 },
        ],
      },
      {
        id: 'banana-mint-sugar',
        observedDisplayName: '活力 戀人',
        salePrice: 47,
        ingredients: ['香蕉', '薄荷', '糖'],
        effects: [
          { name: '補充精力', value: 7 },
          { name: '甜味', value: 6 },
          { name: '清新口氣', value: 4 },
          { name: '紓解壓力', value: 4 },
        ],
      },
      {
        id: 'pear-mint-sugar-cinnamon',
        observedDisplayName: '甜味 暴風',
        salePrice: 70,
        ingredients: ['梨', '薄荷', '糖', '肉桂'],
        effects: [
          { name: '甜味', value: 5 },
          { name: '調節血糖', value: 4 },
          { name: '保護心臟', value: 4 },
          { name: '清新口氣', value: 4 },
          { name: '促進消化', value: 4 },
        ],
      },
      {
        id: 'orange-sugar-mint-cinnamon',
        observedDisplayName: '甜味 滋響',
        salePrice: 67,
        ingredients: ['橙子', '糖', '薄荷', '肉桂'],
        effects: [
          { name: '甜味', value: 5 },
          { name: '調節血糖', value: 4 },
          { name: '芳香', value: 4 },
          { name: '清新口氣', value: 4 },
          { name: '增強免疫', value: 4 },
        ],
      },
      {
        id: 'carrot-mint-sugar-cinnamon',
        observedDisplayName: '血糖平衡 勇士',
        salePrice: 66,
        ingredients: ['紅蘿蔔', '薄荷', '糖', '肉桂'],
        effects: [
          { name: '調節血糖', value: 7 },
          { name: '甜味', value: 5 },
          { name: '清新口氣', value: 4 },
          { name: '改善視力', value: 4 },
          { name: '芳香', value: 3 },
        ],
      },
      {
        id: 'banana-mint-sugar-cinnamon',
        observedDisplayName: '活力 純真',
        salePrice: 73,
        ingredients: ['香蕉', '薄荷', '糖', '肉桂'],
        effects: [
          { name: '補充精力', value: 7 },
          { name: '甜味', value: 6 },
          { name: '調節血糖', value: 4 },
          { name: '清新口氣', value: 4 },
          { name: '紓解壓力', value: 4 },
        ],
      },
    ] as const

    for (const observation of observations) {
      expect(recipeById(observation.id)).toMatchObject(observation)
    }
  })

  it('stores the 2026-09-25 observed recipe batch with the confirmed cup ordering', () => {
    const observations = [
      {
        id: 'carrot-cinnamon',
        observedDisplayName: '紅蘿蔔 - 肉桂（調製飲品）',
        salePrice: 31,
        ingredients: ['紅蘿蔔', '肉桂'],
        effects: [
          { name: '調節血糖', value: 7 },
          { name: '改善視力', value: 4 },
          { name: '輔助瘦身', value: 2 },
        ],
      },
      {
        id: 'lemon-cinnamon',
        observedDisplayName: '檸檬 - 肉桂（調製飲品）',
        salePrice: 30,
        ingredients: ['檸檬', '肉桂'],
        effects: [
          { name: '調節血糖', value: 4 },
          { name: '酸味', value: 4 },
          { name: '輔助瘦身', value: 3 },
        ],
      },
      {
        id: 'carrot-cinnamon-banana-blend',
        observedDisplayName: '血糖平衡 極樂',
        salePrice: 53,
        ingredients: ['紅蘿蔔', '肉桂', '香蕉'],
        effects: [
          { name: '調節血糖', value: 7 },
          { name: '補充精力', value: 4 },
          { name: '改善視力', value: 4 },
          { name: '紓解壓力', value: 3 },
        ],
      },
      {
        id: 'banana-cinnamon-orange-mint-blend',
        observedDisplayName: '清口 刺激',
        salePrice: 78,
        ingredients: ['香蕉', '肉桂', '橙子', '薄荷'],
        effects: [
          { name: '清新口氣', value: 4 },
          { name: '芳香', value: 4 },
          { name: '紓解壓力', value: 4 },
          { name: '增強免疫', value: 4 },
          { name: '調節血糖', value: 4 },
        ],
      },
      {
        id: 'lemon-cinnamon-orange-mint-blend',
        observedDisplayName: '免疫 繁榮',
        salePrice: 70,
        ingredients: ['檸檬', '肉桂', '橙子', '薄荷'],
        effects: [
          { name: '增強免疫', value: 7 },
          { name: '清新口氣', value: 4 },
          { name: '芳香', value: 4 },
          { name: '調節血糖', value: 4 },
          { name: '酸味', value: 4 },
        ],
      },
      {
        id: 'orange-banana-lemon-sugar-blend',
        observedDisplayName: '活力 水晶',
        salePrice: 59,
        ingredients: ['橙子', '香蕉', '檸檬', '糖'],
        effects: [
          { name: '補充精力', value: 7 },
          { name: '增強免疫', value: 7 },
          { name: '甜味', value: 6 },
          { name: '酸味', value: 4 },
          { name: '紓解壓力', value: 3 },
        ],
      },
      {
        id: 'banana-cinnamon-orange-mint-lemon-blend',
        observedDisplayName: '免疫 爆炎',
        salePrice: 98,
        ingredients: ['香蕉', '肉桂', '橙子', '薄荷', '檸檬'],
        effects: [
          { name: '增強免疫', value: 7 },
          { name: '酸味', value: 4 },
          { name: '清新口氣', value: 4 },
          { name: '芳香', value: 4 },
          { name: '紓解壓力', value: 4 },
        ],
      },
      {
        id: 'carrot-cinnamon-banana-pear-mint-blend',
        observedDisplayName: '血糖平衡 夜幕',
        salePrice: 102,
        ingredients: ['紅蘿蔔', '肉桂', '香蕉', '梨', '薄荷'],
        effects: [
          { name: '調節血糖', value: 7 },
          { name: '促進消化', value: 5 },
          { name: '清新口氣', value: 4 },
          { name: '紓解壓力', value: 4 },
          { name: '保護心臟', value: 4 },
        ],
      },
      {
        id: 'orange-orange-blend',
        observedDisplayName: '橙子 - 橙子（調製飲品）',
        salePrice: 12,
        ingredients: ['橙子', '橙子'],
        effects: [
          { name: '增強免疫', value: 8 },
          { name: '煥亮肌膚', value: 4 },
        ],
      },
      {
        id: 'orange-orange-carrot-cinnamon-blend',
        observedDisplayName: '免疫 摯友',
        salePrice: 48,
        ingredients: ['橙子', '橙子', '紅蘿蔔', '肉桂'],
        effects: [
          { name: '增強免疫', value: 9 },
          { name: '調節血糖', value: 7 },
          { name: '改善視力', value: 4 },
          { name: '煥亮肌膚', value: 4 },
        ],
      },
      {
        id: 'carrot-cinnamon-orange-blend',
        observedDisplayName: '血糖平衡 衝擊',
        salePrice: 48,
        ingredients: ['紅蘿蔔', '肉桂', '橙子'],
        effects: [
          { name: '調節血糖', value: 7 },
          { name: '增強免疫', value: 5 },
          { name: '改善視力', value: 4 },
          { name: '煥亮肌膚', value: 2 },
        ],
      },
      {
        id: 'carrot-cinnamon-orange-orange-blend',
        observedDisplayName: '免疫 純真',
        salePrice: 48,
        ingredients: ['紅蘿蔔', '肉桂', '橙子', '橙子'],
        effects: [
          { name: '增強免疫', value: 9 },
          { name: '調節血糖', value: 7 },
          { name: '煥亮肌膚', value: 4 },
          { name: '改善視力', value: 4 },
        ],
      },
    ] as const

    for (const observation of observations) {
      expect(recipeById(observation.id)).toMatchObject(observation)
    }

    // The third screenshot re-confirms the already canonical lemon-orange blend.
    expect(recipeById('lemon-orange-blend')).toMatchObject({
      salePrice: 24,
      ingredients: ['檸檬', '橙子'],
      effects: [
        { name: '增強免疫', value: 7 },
        { name: '酸味', value: 4 },
        { name: '煥亮肌膚', value: 2 },
      ],
    })
  })

  it('stores the tranquil-fountain screenshots as canonical observed recipes', () => {
    expect(recipeById('pear-cinnamon')).toMatchObject({
      observedDisplayName: '梨 - 肉桂（調製飲品）',
      salePrice: 35,
      ingredients: ['梨', '肉桂'],
      effects: [
        { name: '調節血糖', value: 4 },
        { name: '保護心臟', value: 4 },
        { name: '促進消化', value: 4 },
      ],
    })
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

  it('stores the 2026-09-26 observed blender screenshot and preserves reconfirmed recipe identity', () => {
    expect(recipeById('lemon-sugar-orange-mint-blend')).toMatchObject({
      observedDisplayName: '免疫 溫柔',
      salePrice: 57,
      ingredients: ['檸檬', '糖', '橙子', '薄荷'],
      effects: [
        { name: '增強免疫', value: 7 },
        { name: '甜味', value: 5 },
        { name: '清新口氣', value: 4 },
        { name: '酸味', value: 4 },
        { name: '舒緩腸胃', value: 3 },
      ],
    })

    // The other screenshot reconfirms the existing ordered identity.
    // "血糖平衡 護盾" is another random display suffix, not a second recipe.
    expect(recipeById('carrot-cinnamon-orange-blend')).toMatchObject({
      salePrice: 48,
      ingredients: ['紅蘿蔔', '肉桂', '橙子'],
      effects: [
        { name: '調節血糖', value: 7 },
        { name: '增強免疫', value: 5 },
        { name: '改善視力', value: 4 },
        { name: '煥亮肌膚', value: 2 },
      ],
    })
  })

  it('stores the 2026-09-24 blender screenshots with the observed bottom-to-top ordering', () => {
    const observations = [
      {
        id: 'orange-banana-blend',
        observedDisplayName: '橙子 - 香蕉（調製飲品）',
        salePrice: 31,
        ingredients: ['橙子', '香蕉'],
        effects: [
          { name: '補充精力', value: 4 },
          { name: '增強免疫', value: 4 },
          { name: '紓解壓力', value: 3 },
        ],
      },
      {
        id: 'pear-banana-blend',
        observedDisplayName: '梨 - 香蕉（調製飲品）',
        salePrice: 34,
        ingredients: ['梨', '香蕉'],
        effects: [
          { name: '促進消化', value: 5 },
          { name: '補充精力', value: 4 },
          { name: '紓解壓力', value: 3 },
        ],
      },
      {
        id: 'pear-carrot-blend',
        observedDisplayName: '梨 - 紅蘿蔔（調製飲品）',
        salePrice: 28,
        ingredients: ['梨', '紅蘿蔔'],
        effects: [
          { name: '改善視力', value: 4 },
          { name: '促進消化', value: 4 },
          { name: '調節血糖', value: 3 },
        ],
      },
      {
        id: 'orange-banana-lemon-blend',
        observedDisplayName: '免疫 爆裂',
        salePrice: 46,
        ingredients: ['橙子', '香蕉', '檸檬'],
        effects: [
          { name: '增強免疫', value: 7 },
          { name: '酸味', value: 4 },
          { name: '補充精力', value: 4 },
          { name: '紓解壓力', value: 3 },
        ],
      },
      {
        id: 'pear-carrot-lemon-blend',
        observedDisplayName: '酸味 雷霆',
        salePrice: 42,
        ingredients: ['梨', '紅蘿蔔', '檸檬'],
        effects: [
          { name: '酸味', value: 4 },
          { name: '增強免疫', value: 4 },
          { name: '保護心臟', value: 4 },
          { name: '改善視力', value: 4 },
        ],
      },
      {
        id: 'pear-cinnamon-lemon-blend',
        observedDisplayName: '護心 光芒',
        salePrice: 49,
        ingredients: ['梨', '肉桂', '檸檬'],
        effects: [
          { name: '保護心臟', value: 5 },
          { name: '酸味', value: 4 },
          { name: '輔助瘦身', value: 4 },
          { name: '調節血糖', value: 4 },
        ],
      },
      {
        id: 'pear-banana-carrot-mint-blend',
        observedDisplayName: '助消 勇士',
        salePrice: 73,
        ingredients: ['梨', '香蕉', '紅蘿蔔', '薄荷'],
        effects: [
          { name: '促進消化', value: 5 },
          { name: '清新口氣', value: 4 },
          { name: '紓解壓力', value: 4 },
          { name: '改善視力', value: 4 },
          { name: '補充精力', value: 4 },
        ],
      },
      {
        id: 'orange-sugar-mint-cinnamon-pear-blend',
        observedDisplayName: '護心 暗影',
        salePrice: 92,
        ingredients: ['橙子', '糖', '薄荷', '肉桂', '梨'],
        effects: [
          { name: '保護心臟', value: 5 },
          { name: '甜味', value: 5 },
          { name: '促進消化', value: 4 },
          { name: '調節血糖', value: 4 },
          { name: '芳香', value: 4 },
        ],
      },
    ] as const

    for (const observation of observations) {
      expect(recipeById(observation.id)).toMatchObject(observation)
    }

    // The five-ingredient screenshot is the same ordered canonical recipe
    // already observed as "甜味 衝擊"; the random suffix is not recipe identity.
    expect(recipeById('lemon-carrot-mint-sugar-pear-blend')).toMatchObject({
      salePrice: 80,
      ingredients: ['檸檬', '紅蘿蔔', '薄荷', '糖', '梨'],
      effects: [
        { name: '甜味', value: 5 },
        { name: '促進消化', value: 4 },
        { name: '保護心臟', value: 4 },
        { name: '清新口氣', value: 4 },
        { name: '改善視力', value: 4 },
      ],
    })
  })
})
