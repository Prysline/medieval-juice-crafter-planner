import { describe, expect, it } from 'vitest'
import { customers } from '../data/customers'
import {
  nextFormalCustomerRequirementForVillage,
  nextProgressGoal,
} from './progressGoal'

describe('next progress goal', () => {
  it('derives Stage 3 thresholds from canonical progress requirements', () => {
    const formalCustomerIds = customers
      .filter((customer) => customer.villageId === 'east-harbor')
      .slice(0, 10)
      .map((customer) => customer.id)

    const goal = nextProgressGoal({
      currentProgress: 'seasoner-unlocked',
      satisfactionByVillage: {
        'east-harbor': 100,
        'tranquil-fountain': 0,
        'ibex-statue': 0,
      },
      customerDefinitions: customers,
      formalCustomerIds,
    })

    expect(goal?.milestone.id).toBe('juice-jar-unlocked')
    expect(goal?.region).toBeNull()
    expect(goal?.thresholds).toEqual([
      {
        kind: 'satisfaction',
        villageId: 'east-harbor',
        current: 100,
        required: 120,
        remaining: 20,
      },
      {
        kind: 'formal-customers',
        villageId: 'east-harbor',
        current: 10,
        required: 14,
        remaining: 4,
      },
    ])
  })

  it('derives Stage 4 thresholds without reading stage chapter data', () => {
    const goal = nextProgressGoal({
      currentProgress: 'juice-jar-unlocked',
      satisfactionByVillage: {
        'east-harbor': 200,
        'tranquil-fountain': 0,
        'ibex-statue': 0,
      },
      customerDefinitions: customers,
      formalCustomerIds: customers
        .filter((customer) => customer.villageId === 'east-harbor')
        .slice(0, 10)
        .map((customer) => customer.id),
    })

    expect(goal?.milestone.id).toBe('juicer-unlocked')
    expect(goal?.thresholds).toEqual([
      {
        kind: 'satisfaction',
        villageId: 'east-harbor',
        current: 200,
        required: 220,
        remaining: 20,
      },
      {
        kind: 'formal-customers',
        villageId: 'east-harbor',
        current: 10,
        required: 17,
        remaining: 7,
      },
    ])
  })

  it('recognizes a Region milestone without inventing a numeric requirement', () => {
    const goal = nextProgressGoal({
      currentProgress: 'juicer-unlocked',
      satisfactionByVillage: {
        'east-harbor': 999,
        'tranquil-fountain': 999,
        'ibex-statue': 999,
      },
      customerDefinitions: customers,
      formalCustomerIds: customers.map((customer) => customer.id),
    })

    expect(goal?.milestone.id).toBe('tranquil-fountain-unlocked')
    expect(goal?.region?.id).toBe('tranquil-fountain')
    expect(goal?.thresholds).toEqual([])
  })

  it('returns no next goal after the last confirmed progress milestone', () => {
    expect(
      nextProgressGoal({
        currentProgress: 'liquid-blender-unlocked',
        satisfactionByVillage: {
          'east-harbor': 1000,
          'tranquil-fountain': 450,
          'ibex-statue': 130,
        },
        customerDefinitions: customers,
        formalCustomerIds: customers.map((customer) => customer.id),
      }),
    ).toBeNull()
  })

  it('finds the next future formal-customer threshold from the same authority', () => {
    expect(
      nextFormalCustomerRequirementForVillage(
        'juice-jar-unlocked',
        'east-harbor',
      ),
    ).toMatchObject({
      milestone: { id: 'juicer-unlocked' },
      required: 17,
    })

    expect(
      nextFormalCustomerRequirementForVillage(
        'ibex-statue-unlocked',
        'ibex-statue',
      ),
    ).toMatchObject({
      milestone: { id: 'advanced-juicer-unlocked' },
      required: 7,
    })
  })
})
