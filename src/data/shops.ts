import type { ShopDefinition } from '../types'

export const shops: ShopDefinition[] = [
  {
    id: 'tranquil-fountain-spice-merchant',
    name: '香料商人',
    villageId: 'tranquil-fountain',
    unlockedAt: 'tranquil-fountain-unlocked',
    inventory: [
      { ingredientId: 'cinnamon', buyPrice: 16 },
      { ingredientId: 'sugar', buyPrice: 7 },
    ],
  },
  {
    id: 'tranquil-fountain-produce-merchant',
    name: '蔬果商',
    villageId: 'tranquil-fountain',
    unlockedAt: 'tranquil-fountain-unlocked',
    inventory: [
      { ingredientId: 'banana', buyPrice: 15 },
      { ingredientId: 'orange', buyPrice: 11 },
      { ingredientId: 'lemon', buyPrice: 9 },
    ],
  },
]
