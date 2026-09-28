import { describe, expect, it } from 'vitest'
import { recipes } from './recipes'
import { evaluateRecipeSequence } from '../domain/recipeEvaluator'

const observedBatch = [
  {
    id: 'tomato-milk',
    ingredientIds: ['tomato', 'milk'],
    ingredients: ['番茄', '牛奶'],
    observedDisplayName: '番茄 - 牛奶（調製飲品）',
    unlockedAt: 'liquid-blender-unlocked',
    salePrice: 31,
    effects: [
      { name: '奶香', value: 6 },
      { name: '保護心臟', value: 4 },
      { name: '強健骨骼', value: 3 },
    ],
    equipment: ['榨汁機', '液料調和器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'lemon-milk',
    ingredientIds: ['lemon', 'milk'],
    ingredients: ['檸檬', '牛奶'],
    observedDisplayName: '檸檬 - 牛奶（調製飲品）',
    unlockedAt: 'liquid-blender-unlocked',
    salePrice: 28,
    effects: [
      { name: '奶香', value: 6 },
      { name: '酸味', value: 4 },
      { name: '強健骨骼', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '液料調和器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'lemon-milk-sugar',
    ingredientIds: ['lemon', 'milk', 'sugar'],
    ingredients: ['檸檬', '牛奶', '糖'],
    observedDisplayName: '奶香 豐饒',
    unlockedAt: 'liquid-blender-unlocked',
    salePrice: 39,
    effects: [
      { name: '奶香', value: 6 },
      { name: '甜味', value: 5 },
      { name: '酸味', value: 4 },
      { name: '補充精力', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '液料調和器', '調味器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'lemon-mint-milk',
    ingredientIds: ['lemon', 'mint', 'milk'],
    ingredients: ['檸檬', '薄荷', '牛奶'],
    observedDisplayName: '奶香 增益',
    unlockedAt: 'liquid-blender-unlocked',
    salePrice: 48,
    effects: [
      { name: '奶香', value: 6 },
      { name: '清新口氣', value: 4 },
      { name: '酸味', value: 4 },
      { name: '強健骨骼', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '調味器', '液料調和器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'lemon-sugar-milk',
    ingredientIds: ['lemon', 'sugar', 'milk'],
    ingredients: ['檸檬', '糖', '牛奶'],
    observedDisplayName: '奶香 爆裂',
    unlockedAt: 'liquid-blender-unlocked',
    salePrice: 39,
    effects: [
      { name: '奶香', value: 6 },
      { name: '甜味', value: 5 },
      { name: '酸味', value: 4 },
      { name: '強健骨骼', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '調味器', '液料調和器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'pear-tomato-milk-blend',
    ingredientIds: ['pear', 'tomato', 'milk'],
    ingredients: ['梨', '番茄', '牛奶'],
    observedDisplayName: '護心 溫柔',
    unlockedAt: 'liquid-blender-unlocked',
    salePrice: 51,
    effects: [
      { name: '保護心臟', value: 7 },
      { name: '奶香', value: 6 },
      { name: '促進消化', value: 4 },
      { name: '強健骨骼', value: 3 },
    ],
    equipment: ['榨汁機', '液料調和器', '果汁調和器', '果汁成品台'],
    usesBlender: true,
  },
  {
    id: 'carrot-cinnamon-banana-lemon-blend',
    ingredientIds: ['carrot', 'cinnamon', 'banana', 'lemon'],
    ingredients: ['紅蘿蔔', '肉桂', '香蕉', '檸檬'],
    observedDisplayName: '血糖平衡 利爪',
    unlockedAt: 'juice-blender-unlocked',
    salePrice: 70,
    effects: [
      { name: '調節血糖', value: 7 },
      { name: '酸味', value: 4 },
      { name: '增強免疫', value: 4 },
      { name: '補充精力', value: 4 },
      { name: '改善視力', value: 4 },
    ],
    equipment: ['榨汁機', '調味器', '柑橘榨汁機', '果汁調和器', '果汁成品台'],
    usesBlender: true,
  },
  {
    id: 'lemon-mint-milk-orange-blend',
    ingredientIds: ['lemon', 'mint', 'milk', 'orange'],
    ingredients: ['檸檬', '薄荷', '牛奶', '橙子'],
    observedDisplayName: '免疫 星光',
    unlockedAt: 'liquid-blender-unlocked',
    salePrice: 67,
    effects: [
      { name: '增強免疫', value: 7 },
      { name: '奶香', value: 6 },
      { name: '清新口氣', value: 4 },
      { name: '酸味', value: 4 },
      { name: '芳香', value: 3 },
    ],
    equipment: [
      '柑橘榨汁機',
      '調味器',
      '液料調和器',
      '果汁調和器',
      '果汁成品台',
    ],
    usesBlender: true,
  },
  {
    id: 'pear-tomato-milk-banana-blend',
    ingredientIds: ['pear', 'tomato', 'milk', 'banana'],
    ingredients: ['梨', '番茄', '牛奶', '香蕉'],
    observedDisplayName: '護心 勝利',
    unlockedAt: 'liquid-blender-unlocked',
    salePrice: 76,
    effects: [
      { name: '保護心臟', value: 7 },
      { name: '奶香', value: 6 },
      { name: '促進消化', value: 5 },
      { name: '補充精力', value: 4 },
      { name: '紓解壓力', value: 3 },
    ],
    equipment: ['榨汁機', '液料調和器', '果汁調和器', '果汁成品台'],
    usesBlender: true,
  },
] as const

describe('2026-09-28 observed milk recipe batches', () => {
  it('stores the observed milk screenshots while keeping blood-sugar claw as one canonical recipe', () => {
    for (const observation of observedBatch) {
      const recipe = recipes.find((item) => item.id === observation.id)

      expect(recipe).toMatchObject({
        id: observation.id,
        ingredients: observation.ingredients,
        observedDisplayName: observation.observedDisplayName,
        unlockedAt: observation.unlockedAt,
        salePrice: observation.salePrice,
        effects: observation.effects,
        equipment: observation.equipment,
      })
    }

    expect(
      recipes.filter(
        (recipe) => recipe.observedDisplayName === '血糖平衡 利爪',
      ),
    ).toHaveLength(1)
  })

  it('uses the observed overlays and preserves the blender boundary at Stage 10', () => {
    for (const observation of observedBatch) {
      const result = evaluateRecipeSequence(
        [...observation.ingredientIds],
        'liquid-blender-unlocked',
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
      expect(result.usesBlender).toBe(observation.usesBlender)
    }
  })
})
