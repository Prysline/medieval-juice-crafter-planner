import { describe, expect, it } from 'vitest'
import { equipment } from './equipment'
import { progressMilestones } from './progress'
import { stages } from './stages'

describe('Stage 7 observed data', () => {
  it('records both village customer-count requirements', () => {
    const stage7 = stages.find((stage) => stage.id === 7)

    expect(stage7?.unlockRequirement).toMatchObject({
      formalCustomersByVillageRequired: {
        'east-harbor': 29,
        'tranquil-fountain': 15,
      },
      action: '寄信給爺爺',
      timing: '收到回信後解鎖；約 6 小時規則待驗證',
    })
  })

  it('records the advanced citrus juicer shop data without inventing throughput', () => {
    const milestone = progressMilestones.find(
      (item) => item.id === 'advanced-citrus-juicer-unlocked',
    )
    const juicer = equipment.find(
      (item) => item.id === 'advanced-citrus-juicer',
    )

    expect(milestone?.label).toBe('階段七｜高級柑橘榨汁機已解鎖')
    expect(juicer).toMatchObject({
      name: '高級柑橘榨汁機',
      unlockedAt: 'advanced-citrus-juicer-unlocked',
      buyPrice: 1200,
      seller: '木匠',
    })
    expect(juicer?.note).toContain('節省柑橘榨汁時間')
    expect(juicer?.note).toContain('尚未確認')
  })

  it('keeps the six-hour reply behavior as an observation instead of a fixed rule', () => {
    const stage7 = stages.find((stage) => stage.id === 7)

    expect(stage7?.progressionNotes).toEqual([
      '目前兩次主線信件觀察約為 08:4X 寄信 → 14:00 回信、09:XX 寄信 → 15:00 回信。',
      '兩次都接近寄信後 6 小時，因此「約 6 小時後回信」目前是強烈推測，但尚未升格為固定規則。',
      '玩家推測若寄信時間太晚，可能要等隔天才能取信；目前尚缺直接跨日邊界實測。',
    ])
  })
})
