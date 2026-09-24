import { describe, expect, it } from 'vitest'
import { customers } from './customers'
import { equipment } from './equipment'
import { progressMilestones } from './progress'
import { stages } from './stages'

describe('Stage 6 observed data', () => {
  it('records Daniel customer preferences from the direct screenshot', () => {
    const daniel = customers.find((customer) => customer.id === 'daniel')

    expect(daniel?.preferences).toEqual([
      { kind: 'effect', value: '奶香' },
      { kind: 'effect', value: '保護心臟' },
      { kind: 'effect', value: '促進消化' },
    ])
  })

  it('requires both village satisfaction thresholds before the Stage 6 letter', () => {
    const stage6 = stages.find((stage) => stage.id === 6)

    expect(stage6?.unlockRequirement).toMatchObject({
      satisfactionByVillageRequired: {
        'east-harbor': 525,
        'tranquil-fountain': 25,
      },
      action: '寄信給爺爺',
      timing: '收到回信後解鎖；等待時間未確認',
    })
  })

  it('records the advanced tragic washing station without inventing reply timing or water cost', () => {
    const milestone = progressMilestones.find(
      (item) => item.id === 'advanced-tragic-washing-station-unlocked',
    )
    const station = equipment.find(
      (item) => item.id === 'advanced-tragic-washing-station',
    )

    expect(milestone?.label).toBe('階段六｜高級悲劇清洗台已解鎖')
    expect(station).toMatchObject({
      name: '高級悲劇清洗台',
      unlockedAt: 'advanced-tragic-washing-station-unlocked',
      buyPrice: 1000,
      seller: '木匠',
    })
    expect(station?.note).toContain('一次可清洗 5 個杯子')
    expect(station?.note).toContain('回信等待時間')
    expect(station?.note).toContain('清洗水量尚未確認')
  })
})
