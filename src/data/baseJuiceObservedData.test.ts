import { describe, expect, it } from 'vitest'
import { recipes } from './recipes'

function recipeById(id: string) {
  const recipe = recipes.find((item) => item.id === id)
  if (!recipe) throw new Error(`Missing observed base juice: ${id}`)
  return recipe
}

describe('observed base juice catalog', () => {
  const observations = [
    {
      id: 'tomato-juice',
      name: '番茄汁',
      salePrice: 12,
      ingredients: ['番茄'],
      effects: [
        { name: '保護心臟', value: 4 },
        { name: '煥亮肌膚', value: 2 },
      ],
      unlockedAt: 'ibex-statue-unlocked',
    },
    {
      id: 'cucumber-juice',
      name: '黃瓜汁',
      salePrice: 13,
      ingredients: ['黃瓜'],
      effects: [
        { name: '補充水分', value: 4 },
        { name: '輔助瘦身', value: 2 },
      ],
      unlockedAt: 'ibex-statue-unlocked',
    },
    {
      id: 'peach-juice',
      name: '桃汁',
      salePrice: 17,
      ingredients: ['桃子'],
      effects: [
        { name: '促進消化', value: 4 },
        { name: '舒緩呼吸', value: 2 },
      ],
      unlockedAt: 'ibex-statue-unlocked',
    },
    {
      id: 'pear-juice',
      name: '梨汁',
      salePrice: 13,
      ingredients: ['梨'],
      effects: [
        { name: '促進消化', value: 4 },
        { name: '保護心臟', value: 3 },
      ],
      unlockedAt: 'juicer-unlocked',
    },
    {
      id: 'banana-juice',
      name: '香蕉汁',
      salePrice: 15,
      ingredients: ['香蕉'],
      effects: [
        { name: '補充精力', value: 4 },
        { name: '紓解壓力', value: 3 },
      ],
      unlockedAt: 'tranquil-fountain-unlocked',
    },
    {
      id: 'carrot-juice',
      name: '紅蘿蔔汁',
      salePrice: 10,
      ingredients: ['紅蘿蔔'],
      effects: [
        { name: '改善視力', value: 4 },
        { name: '調節血糖', value: 3 },
      ],
      unlockedAt: 'juicer-unlocked',
    },
    {
      id: 'lemon-juice',
      name: '檸檬汁',
      salePrice: 9,
      ingredients: ['檸檬'],
      effects: [
        { name: '酸味', value: 4 },
        { name: '增強免疫', value: 5 },
      ],
      unlockedAt: 'opening',
    },
  ] as const

  for (const observation of observations) {
    it(`stores ${observation.name} name, price, and observed effects`, () => {
      expect(recipeById(observation.id)).toMatchObject({
        ...observation,
        equipment:
          observation.id === 'lemon-juice'
            ? ['柑橘榨汁機', '果汁成品台']
            : ['榨汁機', '果汁成品台'],
      })
    })
  }

  it('does not infer a general raw-ingredient-to-sale-price rule', () => {
    expect(observations.map((item) => item.salePrice)).toEqual([
      12, 13, 17, 13, 15, 10, 9,
    ])
  })
})
