import { describe, expect, it } from 'vitest'
import type { Customer, SatisfactionByVillage } from '../types'
import {
  optimizerCustomerIds,
  optimizerCustomerLabel,
  optimizerMoney,
  optimizerOperationQuantities,
  optimizerWaterFetchSlots,
  type OptimizerCustomerScope,
  type OptimizerCustomerTarget,
} from './optimizerUi'

const customers: Customer[] = [
  {
    id: 'open-potential',
    name: 'Open Potential',
    occupation: '測試',
    villageId: 'east-harbor',
    satisfactionRequired: 0,
    preferences: [{ kind: 'effect', value: '甜味' }],
  },
  {
    id: 'open-formal',
    name: 'Open Formal',
    occupation: '測試',
    villageId: 'east-harbor',
    satisfactionRequired: 0,
    preferences: [{ kind: 'effect', value: '甜味' }],
  },
  {
    id: 'locked',
    name: 'Locked',
    occupation: '測試',
    villageId: 'east-harbor',
    satisfactionRequired: 100,
    preferences: [{ kind: 'effect', value: '甜味' }],
  },
  {
    id: 'future-village',
    name: 'Future Village',
    occupation: '測試',
    villageId: 'tranquil-fountain',
    satisfactionRequired: 0,
    preferences: [{ kind: 'effect', value: '甜味' }],
  },
]

const satisfaction: SatisfactionByVillage = {
  'east-harbor': 0,
  'tranquil-fountain': 0,
  'ibex-statue': 0,
}

function ids(
  scope: OptimizerCustomerScope,
  suppliedCustomerIds: string[] = [],
  target: OptimizerCustomerTarget = { mode: 'all' },
) {
  return optimizerCustomerIds(
    customers,
    'seasoner-unlocked',
    satisfaction,
    suppliedCustomerIds,
    ['open-formal'],
    scope,
    target,
  )
}

describe('optimizer UI demand selection', () => {
  it('defaults to unlocked and unsupplied customers only', () => {
    expect(ids('all')).toEqual(['open-potential', 'open-formal'])
    expect(ids('all', ['open-formal'])).toEqual(['open-potential'])
  })

  it('separates potential and formal customer scopes', () => {
    expect(ids('potential')).toEqual(['open-potential'])
    expect(ids('formal')).toEqual(['open-formal'])
  })
  it('filters the eligible demand by selected villages without changing optimizer eligibility', () => {
    expect(
      optimizerCustomerIds(
        customers,
        'tranquil-fountain-unlocked',
        satisfaction,
        [],
        ['open-formal'],
        'all',
        { mode: 'villages', villageIds: ['tranquil-fountain'] },
      ),
    ).toEqual(['future-village'])

    expect(
      ids('all', [], {
        mode: 'villages',
        villageIds: ['east-harbor'],
      }),
    ).toEqual(['open-potential', 'open-formal'])
  })

  it('intersects explicit customer selection with the existing status scope', () => {
    const target: OptimizerCustomerTarget = {
      mode: 'customers',
      customerIds: ['open-potential', 'open-formal', 'locked'],
    }

    expect(ids('all', [], target)).toEqual([
      'open-potential',
      'open-formal',
    ])
    expect(ids('formal', [], target)).toEqual(['open-formal'])
    expect(ids('potential', ['open-potential'], target)).toEqual([])
  })

  it('formats customer labels with occupations and money with an explicit unit', () => {
    expect(
      optimizerCustomerLabel({
        name: '烏爾里希',
        occupation: '旅人',
      }),
    ).toBe('烏爾里希（旅人）')
    expect(optimizerMoney(44)).toBe('44 金幣')
  })

  it('splits displayed machine operations by the confirmed five-per-operation capacity', () => {
    expect(optimizerOperationQuantities(0)).toEqual([])
    expect(optimizerOperationQuantities(1)).toEqual([1])
    expect(optimizerOperationQuantities(5)).toEqual([5])
    expect(optimizerOperationQuantities(7)).toEqual([5, 2])
    expect(optimizerOperationQuantities(11)).toEqual([5, 5, 1])
  })

  it('calculates water fetch slot impact from the confirmed 10-per-slot capacity', () => {
    expect(optimizerWaterFetchSlots(0)).toBe(0)
    expect(optimizerWaterFetchSlots(1)).toBe(1)
    expect(optimizerWaterFetchSlots(10)).toBe(1)
    expect(optimizerWaterFetchSlots(11)).toBe(2)
  })
})
