import { describe, expect, it } from 'vitest'
import { customers } from './customers'
import { visibleCustomers } from '../domain/availability'
import type { SatisfactionByVillage } from '../types'

const satisfaction = (
  ibexStatue: number,
): SatisfactionByVillage => ({
  'east-harbor': 0,
  'tranquil-fountain': 0,
  'ibex-statue': ibexStatue,
})

describe('ibex statue customers', () => {
  it('syncs the 21 confirmed ibex statue customers', () => {
    const ibexCustomers = customers.filter(
      (customer) => customer.villageId === 'ibex-statue',
    )

    expect(ibexCustomers).toHaveLength(21)
    expect(
      ibexCustomers.map((customer) => [
        customer.name,
        customer.occupation,
        customer.satisfactionRequired,
      ]),
    ).toEqual([
      ['茱莉婭', '蔬果商', 0],
      ['羅爾夫', '伐木工', 0],
      ['吉塞拉', '貴婦', 0],
      ['瑪莎', '蔬果商', 0],
      ['哈維', '鞋匠', 0],
      ['查爾斯', '香料商人', 0],
      ['伯納德', '農夫', 0],
      ['多米尼克', '農夫', 0],
      ['貢薩洛', '孩童', 0],
      ['伊莎貝爾', '孩童', 0],
      ['弗羅特加', '管家', 0],
      ['利斯蒙', '女僕', 0],
      ['埃洛伊絲', '貴婦', 0],
      ['奧利佛', '牛奶商人', 0],
      ['安布羅西婭', '貴婦', 0],
      ['蒂芙尼', '貴婦', 0],
      ['佩特拉', '貴婦', 0],
      ['南特爾瑪', '貴婦', 0],
      ['米隆', '書商', 0],
      ['托爾斯滕', '領主', 350],
      ['薩維烏斯', '領主', 250],
    ])
  })

  it('keeps the two directly observed unknown preference sets unknown', () => {
    expect(customers.find((customer) => customer.id === 'thorsten')).toMatchObject({
      name: '托爾斯滕',
      satisfactionRequired: 350,
      preferences: null,
    })
    expect(customers.find((customer) => customer.id === 'savius')).toMatchObject({
      name: '薩維烏斯',
      satisfactionRequired: 250,
      preferences: null,
    })
  })

  it('shows ibex statue customers only after the region milestone', () => {
    const before = visibleCustomers(
      customers,
      'advanced-citrus-juicer-unlocked',
      satisfaction(350),
      true,
    )
    const after = visibleCustomers(
      customers,
      'ibex-statue-unlocked',
      satisfaction(350),
      true,
    )

    expect(before.some((customer) => customer.villageId === 'ibex-statue')).toBe(false)
    expect(
      after.filter((customer) => customer.villageId === 'ibex-statue'),
    ).toHaveLength(21)
  })

  it('applies the recorded ibex statue satisfaction thresholds', () => {
    const atZero = visibleCustomers(
      customers,
      'ibex-statue-unlocked',
      satisfaction(0),
      false,
    ).filter((customer) => customer.villageId === 'ibex-statue')
    const at250 = visibleCustomers(
      customers,
      'ibex-statue-unlocked',
      satisfaction(250),
      false,
    ).filter((customer) => customer.villageId === 'ibex-statue')
    const at350 = visibleCustomers(
      customers,
      'ibex-statue-unlocked',
      satisfaction(350),
      false,
    ).filter((customer) => customer.villageId === 'ibex-statue')

    expect(atZero).toHaveLength(19)
    expect(atZero.map((customer) => customer.id)).not.toContain('savius')
    expect(atZero.map((customer) => customer.id)).not.toContain('thorsten')

    expect(at250).toHaveLength(20)
    expect(at250.map((customer) => customer.id)).toContain('savius')
    expect(at250.map((customer) => customer.id)).not.toContain('thorsten')

    expect(at350).toHaveLength(21)
    expect(at350.map((customer) => customer.id)).toEqual(
      expect.arrayContaining(['savius', 'thorsten']),
    )
  })
})
