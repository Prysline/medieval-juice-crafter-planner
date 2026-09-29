import { describe, expect, it } from 'vitest'
import { equipment } from './equipment'
import { ingredients } from './ingredients'
import { recipeIngredientCapabilities } from './recipeIngredientCapabilities'
import {
  progressMilestoneIndex,
  progressMilestoneLabels,
  progressMilestones,
} from './progress'
import { generateUniqueRecipeCandidateLayers } from '../domain/recipeGenerator'

describe('Stage 9 and 10 observed progression', () => {
  it('records Stage 9 Ibex satisfaction and customer-count requirements', () => {
    const milestone = progressMilestones.find(
      (item) => item.id === 'advanced-juicer-unlocked',
    )

    expect(milestone?.requirement).toEqual({
      satisfactionByVillageRequired: {
        'ibex-statue': 50,
      },
      formalCustomersByVillageRequired: {
        'ibex-statue': 7,
      },
    })

    expect(progressMilestoneLabels['advanced-juicer-unlocked']).toBe(
      '階段九｜高級榨汁機已解鎖',
    )
    expect(
      progressMilestoneIndex.get('advanced-juicer-unlocked'),
    ).toBeGreaterThan(
      progressMilestoneIndex.get('sales-assistant-adam-arrived')!,
    )
  })

  it('records the advanced juicer price without inventing throughput', () => {
    const juicer = equipment.find(
      (item) => item.id === 'advanced-juicer',
    )

    expect(juicer).toMatchObject({
      name: '高級榨汁機',
      unlockedAt: 'advanced-juicer-unlocked',
      buyPrice: 1400,
    })
    expect(juicer?.seller).toBeUndefined()
    expect(juicer?.note).toContain('實際批次容量')
    expect(juicer?.note).toContain('尚未確認')
  })

  it('records all three Stage 10 satisfaction thresholds', () => {
    const milestone = progressMilestones.find(
      (item) => item.id === 'liquid-blender-unlocked',
    )

    expect(milestone?.requirement).toEqual({
      satisfactionByVillageRequired: {
        'east-harbor': 1000,
        'tranquil-fountain': 450,
        'ibex-statue': 130,
      },
    })

    expect(progressMilestoneLabels['liquid-blender-unlocked']).toBe(
      '階段十｜液料調和器已解鎖',
    )
    expect(
      progressMilestoneIndex.get('liquid-blender-unlocked'),
    ).toBeGreaterThan(
      progressMilestoneIndex.get('advanced-juicer-unlocked')!,
    )
  })

  it('records milk as a Stage 10 liquid-blender additive', () => {
    const milk = ingredients.find((item) => item.id === 'milk')
    const milkCapability = recipeIngredientCapabilities.find(
      (capability) => capability.ingredientId === 'milk',
    )

    expect(milk).toMatchObject({
      name: '牛奶',
      unlockedAt: 'liquid-blender-unlocked',
      buyPrice: 14,
      seller: '牛奶商人',
      effects: [
        { name: '奶香', value: 6 },
        { name: '強健骨骼', value: 3 },
      ],
    })
    expect(milkCapability).toEqual({
      ingredientId: 'milk',
      roles: ['seasoning'],
      additiveEquipment: '液料調和器',
    })
  })

  it('includes milk in Stage 10 additive candidate generation', () => {
    const candidates = generateUniqueRecipeCandidateLayers(
      'liquid-blender-unlocked',
    ).flatMap((layer) => layer.candidates)

    expect(
      candidates.some(
        (candidate) =>
          candidate.ingredients.join('>') === '檸檬>牛奶',
      ),
    ).toBe(true)
  })

  it('records the liquid blender price and only the directly observed input categories', () => {
    const blender = equipment.find(
      (item) => item.id === 'liquid-blender',
    )

    expect(blender).toMatchObject({
      name: '液料調和器',
      unlockedAt: 'liquid-blender-unlocked',
      buyPrice: 1500,
    })
    expect(blender?.seller).toBeUndefined()
    expect(blender?.note).toContain('果汁')
    expect(blender?.note).toContain('牛奶、優格、蜂蜜')
    expect(blender?.note).toContain('5 份果汁 + 5 份牛奶 → 5 份下一狀態')
    expect(blender?.note).toContain('每份果汁追加 1 份牛奶')
    expect(blender?.note).toContain('優格／蜂蜜')
    expect(blender?.note).toContain('仍未確認')
  })
})
