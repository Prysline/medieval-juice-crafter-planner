import { describe, expect, it } from 'vitest'
import { evaluateRecipeSequence } from '../domain/recipeEvaluator'
import { recipes } from './recipes'

const observedBatch = [
  {
    id: 'carrot-clove',
    ingredientIds: ['carrot', 'clove'],
    ingredients: ['紅蘿蔔', '丁香'],
    observedDisplayName: '紅蘿蔔 - 丁香（調製飲品）',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 29,
    effects: [
      { name: '調節血糖', value: 7 },
      { name: '改善視力', value: 4 },
      { name: '辛香', value: 3 },
    ],
    equipment: ['榨汁機', '調味器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'cucumber-cinnamon',
    ingredientIds: ['cucumber', 'cinnamon'],
    ingredients: ['黃瓜', '肉桂'],
    observedDisplayName: '黃瓜 - 肉桂（調製飲品）',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 35,
    effects: [
      { name: '調節血糖', value: 5 },
      { name: '輔助瘦身', value: 4 },
      { name: '補充水分', value: 4 },
    ],
    equipment: ['榨汁機', '調味器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'cucumber-mint',
    ingredientIds: ['cucumber', 'mint'],
    ingredients: ['黃瓜', '薄荷'],
    observedDisplayName: '黃瓜 - 薄荷（調製飲品）',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 32,
    effects: [
      { name: '清新口氣', value: 4 },
      { name: '補充水分', value: 4 },
      { name: '舒緩腸胃', value: 3 },
    ],
    equipment: ['榨汁機', '調味器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'lemon-clove',
    ingredientIds: ['lemon', 'clove'],
    ingredients: ['檸檬', '丁香'],
    observedDisplayName: '檸檬 - 丁香（調製飲品）',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 28,
    effects: [
      { name: '調節血糖', value: 4 },
      { name: '酸味', value: 4 },
      { name: '辛香', value: 3 },
    ],
    equipment: ['柑橘榨汁機', '調味器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'peach-cinnamon',
    ingredientIds: ['peach', 'cinnamon'],
    ingredients: ['桃子', '肉桂'],
    observedDisplayName: '桃子 - 肉桂（調製飲品）',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 40,
    effects: [
      { name: '調節血糖', value: 4 },
      { name: '促進消化', value: 4 },
      { name: '輔助瘦身', value: 2 },
    ],
    equipment: ['榨汁機', '調味器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'tomato-cinnamon',
    ingredientIds: ['tomato', 'cinnamon'],
    ingredients: ['番茄', '肉桂'],
    observedDisplayName: '番茄 - 肉桂（調製飲品）',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 34,
    effects: [
      { name: '保護心臟', value: 5 },
      { name: '調節血糖', value: 4 },
      { name: '輔助瘦身', value: 2 },
    ],
    equipment: ['榨汁機', '調味器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'banana-clove-sugar',
    ingredientIds: ['banana', 'clove', 'sugar'],
    ingredients: ['香蕉', '丁香', '糖'],
    observedDisplayName: '活力 輕躁',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 47,
    effects: [
      { name: '補充精力', value: 7 },
      { name: '甜味', value: 6 },
      { name: '調節血糖', value: 4 },
      { name: '辛香', value: 3 },
    ],
    equipment: ['榨汁機', '調味器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'cucumber-cinnamon-sugar',
    ingredientIds: ['cucumber', 'cinnamon', 'sugar'],
    ingredients: ['黃瓜', '肉桂', '糖'],
    observedDisplayName: '甜味 低語',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 47,
    effects: [
      { name: '甜味', value: 5 },
      { name: '調節血糖', value: 5 },
      { name: '輔助瘦身', value: 4 },
      { name: '補充水分', value: 4 },
    ],
    equipment: ['榨汁機', '調味器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'banana-clove-sugar-cinnamon',
    ingredientIds: ['banana', 'clove', 'sugar', 'cinnamon'],
    ingredients: ['香蕉', '丁香', '糖', '肉桂'],
    observedDisplayName: '血糖平衡 刺激',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 73,
    effects: [
      { name: '調節血糖', value: 8 },
      { name: '補充精力', value: 7 },
      { name: '甜味', value: 6 },
      { name: '芳香', value: 3 },
      { name: '辛香', value: 3 },
    ],
    equipment: ['榨汁機', '調味器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'lemon-clove-milk',
    ingredientIds: ['lemon', 'clove', 'milk'],
    ingredients: ['檸檬', '丁香', '牛奶'],
    observedDisplayName: '奶香 暗影',
    unlockedAt: 'liquid-blender-unlocked',
    salePrice: 48,
    effects: [
      { name: '奶香', value: 6 },
      { name: '強健骨骼', value: 4 },
      { name: '調節血糖', value: 4 },
      { name: '酸味', value: 4 },
    ],
    equipment: ['柑橘榨汁機', '調味器', '液料調和器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'lemon-clove-milk-mint',
    ingredientIds: ['lemon', 'clove', 'milk', 'mint'],
    ingredients: ['檸檬', '丁香', '牛奶', '薄荷'],
    observedDisplayName: '奶香 摯友',
    unlockedAt: 'liquid-blender-unlocked',
    salePrice: 71,
    effects: [
      { name: '奶香', value: 6 },
      { name: '清新口氣', value: 4 },
      { name: '舒緩腸胃', value: 4 },
      { name: '芳香', value: 4 },
      { name: '強健骨骼', value: 4 },
    ],
    equipment: ['柑橘榨汁機', '調味器', '液料調和器', '果汁成品台'],
    usesBlender: false,
  },
  {
    id: 'carrot-banana-blend',
    ingredientIds: ['carrot', 'banana'],
    ingredients: ['紅蘿蔔', '香蕉'],
    observedDisplayName: '紅蘿蔔 - 香蕉（調製飲品）',
    unlockedAt: 'juice-blender-unlocked',
    salePrice: 30,
    effects: [
      { name: '補充精力', value: 4 },
      { name: '改善視力', value: 4 },
      { name: '紓解壓力', value: 3 },
    ],
    equipment: ['榨汁機', '果汁調和器', '果汁成品台'],
    usesBlender: true,
  },
  {
    id: 'carrot-banana-lemon-mint-blend',
    ingredientIds: ['carrot', 'banana', 'lemon', 'mint'],
    ingredients: ['紅蘿蔔', '香蕉', '檸檬', '薄荷'],
    observedDisplayName: '清口 星閃',
    unlockedAt: 'juice-blender-unlocked',
    salePrice: 67,
    effects: [
      { name: '清新口氣', value: 4 },
      { name: '紓解壓力', value: 4 },
      { name: '酸味', value: 4 },
      { name: '增強免疫', value: 4 },
      { name: '補充精力', value: 4 },
    ],
    equipment: ['榨汁機', '柑橘榨汁機', '調味器', '果汁調和器', '果汁成品台'],
    usesBlender: true,
  },
  {
    id: 'orange-cucumber-cinnamon-sugar-blend',
    ingredientIds: ['orange', 'cucumber', 'cinnamon', 'sugar'],
    ingredients: ['橙子', '黃瓜', '肉桂', '糖'],
    observedDisplayName: '甜味 佳飲',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 66,
    effects: [
      { name: '甜味', value: 5 },
      { name: '調節血糖', value: 5 },
      { name: '輔助瘦身', value: 4 },
      { name: '補充水分', value: 4 },
      { name: '增強免疫', value: 4 },
    ],
    equipment: ['柑橘榨汁機', '榨汁機', '調味器', '果汁調和器', '果汁成品台'],
    usesBlender: true,
  },
  {
    id: 'tomato-cinnamon-carrot-clove-blend',
    ingredientIds: ['tomato', 'cinnamon', 'carrot', 'clove'],
    ingredients: ['番茄', '肉桂', '紅蘿蔔', '丁香'],
    observedDisplayName: '血糖平衡 藝術',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 73,
    effects: [
      { name: '調節血糖', value: 11 },
      { name: '保護心臟', value: 5 },
      { name: '改善視力', value: 4 },
      { name: '辛香', value: 3 },
      { name: '芳香', value: 3 },
    ],
    equipment: ['榨汁機', '調味器', '果汁調和器', '果汁成品台'],
    usesBlender: true,
  },
  {
    id: 'peach-cinnamon-carrot-mint-sugar-blend',
    ingredientIds: ['peach', 'cinnamon', 'carrot', 'mint', 'sugar'],
    ingredients: ['桃子', '肉桂', '紅蘿蔔', '薄荷', '糖'],
    observedDisplayName: '血糖平衡 安寧',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 96,
    effects: [
      { name: '調節血糖', value: 7 },
      { name: '甜味', value: 5 },
      { name: '清新口氣', value: 4 },
      { name: '改善視力', value: 4 },
      { name: '促進消化', value: 4 },
    ],
    equipment: ['榨汁機', '調味器', '果汁調和器', '果汁成品台'],
    usesBlender: true,
  },
  {
    id: 'cucumber-mint-banana-cinnamon-blend',
    ingredientIds: ['cucumber', 'mint', 'banana', 'cinnamon'],
    ingredients: ['黃瓜', '薄荷', '香蕉', '肉桂'],
    observedDisplayName: '血糖平衡 舞韻',
    unlockedAt: 'ibex-statue-unlocked',
    salePrice: 81,
    effects: [
      { name: '調節血糖', value: 5 },
      { name: '輔助瘦身', value: 4 },
      { name: '補充精力', value: 4 },
      { name: '紓解壓力', value: 4 },
      { name: '清新口氣', value: 4 },
    ],
    equipment: ['榨汁機', '調味器', '果汁調和器', '果汁成品台'],
    usesBlender: true,
  },
] as const

describe('2026-09-28 late-game observed recipe batch', () => {
  it('stores all seventeen screenshots with the confirmed ordered ingredient identity', () => {
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

  it('resolves every sequence through observed authority and preserves Blender boundaries', () => {
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
      expect(result.usesBlender).toBe(observation.usesBlender)
    }
  })
})
