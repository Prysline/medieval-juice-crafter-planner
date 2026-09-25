import { describe, expect, it } from 'vitest'
import { customers } from '../data/customers'
import { equipment } from '../data/equipment'
import { ingredients } from '../data/ingredients'
import { shops } from '../data/shops'
import type { SatisfactionByVillage } from '../types'
import {
  customerIsUnlocked,
  equipmentIsAvailable,
  ingredientIsAvailable,
  shopIsAvailable,
  visibleCustomers,
} from './availability'

const zeroSatisfaction: SatisfactionByVillage = {
  'east-harbor': 0,
  'tranquil-fountain': 0,
  'ibex-statue': 0,
}

describe('progress and village availability', () => {
  it('keeps tranquil fountain content out of juicer-unlocked', () => {
    const availableIngredientIds = ingredients
      .filter((ingredient) => ingredientIsAvailable(ingredient, 'juicer-unlocked'))
      .map((ingredient) => ingredient.id)

    expect(availableIngredientIds).toContain('carrot')
    expect(availableIngredientIds).toContain('pear')
    expect(availableIngredientIds).not.toContain('cinnamon')
    expect(availableIngredientIds).not.toContain('banana')

    expect(
      visibleCustomers(
        customers,
        'juicer-unlocked',
        zeroSatisfaction,
        true,
      ).some((customer) => customer.villageId === 'tranquil-fountain'),
    ).toBe(false)
  })

  it('opens fountain ingredients, customers and shops at tranquil-fountain-unlocked', () => {
    const availableIngredientIds = ingredients
      .filter((ingredient) =>
        ingredientIsAvailable(ingredient, 'tranquil-fountain-unlocked'),
      )
      .map((ingredient) => ingredient.id)

    expect(availableIngredientIds).toContain('cinnamon')
    expect(availableIngredientIds).toContain('banana')
    expect(
      visibleCustomers(
        customers,
        'tranquil-fountain-unlocked',
        zeroSatisfaction,
        true,
      ).some((customer) => customer.id === 'peter'),
    ).toBe(true)
    expect(
      shops.every((shop) => shopIsAvailable(shop, 'tranquil-fountain-unlocked')),
    ).toBe(true)
  })

  it('keeps the juice blender locked until the next milestone', () => {
    const blender = equipment.find((item) => item.id === 'juice-blender')
    expect(blender).toBeDefined()

    expect(
      equipmentIsAvailable(blender!, 'tranquil-fountain-unlocked'),
    ).toBe(false)
    expect(equipmentIsAvailable(blender!, 'juice-blender-unlocked')).toBe(true)
  })

  it('never uses east harbor satisfaction to unlock fountain customers', () => {
    const daniel = customers.find((customer) => customer.id === 'daniel')
    expect(daniel).toBeDefined()

    expect(
      customerIsUnlocked(daniel!, 'tranquil-fountain-unlocked', {
        'east-harbor': 999,
        'tranquil-fountain': 0,
        'ibex-statue': 0,
      }),
    ).toBe(false)
    expect(
      customerIsUnlocked(daniel!, 'tranquil-fountain-unlocked', {
        'east-harbor': 0,
        'tranquil-fountain': 200,
        'ibex-statue': 0,
      }),
    ).toBe(true)
  })

  it('never uses fountain satisfaction to unlock east harbor customers', () => {
    const betsy = customers.find((customer) => customer.id === 'betsy')
    expect(betsy).toBeDefined()

    expect(
      customerIsUnlocked(betsy!, 'tranquil-fountain-unlocked', {
        'east-harbor': 0,
        'tranquil-fountain': 999,
        'ibex-statue': 0,
      }),
    ).toBe(false)
  })

  it('all-customers mode ignores only the village threshold, not region availability', () => {
    expect(
      visibleCustomers(
        customers,
        'juicer-unlocked',
        {
          'east-harbor': 999,
          'tranquil-fountain': 999,
          'ibex-statue': 0,
        },
        true,
      ).some((customer) => customer.id === 'daniel'),
    ).toBe(false)

    expect(
      visibleCustomers(
        customers,
        'tranquil-fountain-unlocked',
        zeroSatisfaction,
        true,
      ).some((customer) => customer.id === 'daniel'),
    ).toBe(true)
  })
})
