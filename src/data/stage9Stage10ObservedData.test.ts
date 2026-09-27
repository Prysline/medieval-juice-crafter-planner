import { describe, expect, it } from 'vitest'
import { equipment } from './equipment'
import {
  progressMilestoneIndex,
  progressMilestoneLabels,
} from './progress'
import { stages } from './stages'

describe('Stage 9 and 10 observed progression', () => {
  it('records Stage 9 Ibex satisfaction and customer-count requirements', () => {
    const stage9 = stages.find((stage) => stage.id === 9)

    expect(stage9?.unlockRequirement).toMatchObject({
      satisfactionByVillageRequired: {
        'ibex-statue': 50,
      },
      formalCustomersByVillageRequired: {
        'ibex-statue': 7,
      },
      action: '寄信給爺爺',
      timing: '收到回信後解鎖；等待時間未確認',
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
    const stage10 = stages.find((stage) => stage.id === 10)

    expect(stage10?.unlockRequirement).toMatchObject({
      satisfactionByVillageRequired: {
        'east-harbor': 1000,
        'tranquil-fountain': 450,
        'ibex-statue': 130,
      },
      action: '寄信給爺爺',
      timing: '收到回信後解鎖；等待時間未確認',
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
    expect(blender?.note).toContain('比例、產量')
    expect(blender?.note).toContain('尚未確認')
  })
})
