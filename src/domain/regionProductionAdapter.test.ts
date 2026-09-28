import { describe, expect, it } from 'vitest'
import {
  availableProductionWorkshopRegions,
  productionCustomerResidenceById,
  productionRegionRoutingInput,
} from './regionProductionAdapter'

describe('region production adapter', () => {
  it('only exposes currently unlocked production Region workshops', () => {
    expect(
      availableProductionWorkshopRegions('opening').map(
        (item) => item.regionId,
      ),
    ).toEqual(['east-harbor'])

    expect(
      availableProductionWorkshopRegions(
        'tranquil-fountain-unlocked',
      ).map((item) => item.regionId),
    ).toEqual(['east-harbor', 'tranquil-fountain'])

    expect(
      availableProductionWorkshopRegions(
        'ibex-statue-unlocked',
      ).map((item) => item.regionId),
    ).toEqual([
      'east-harbor',
      'tranquil-fountain',
      'ibex-statue',
    ])
  })

  it('uses only confirmed production Region edges and rejects a locked active workshop', () => {
    expect(
      productionRegionRoutingInput(
        'ibex-statue-unlocked',
        'east-harbor',
      ),
    ).toEqual({
      activeWorkshop: {
        id: 'workshop:east-harbor',
        regionId: 'east-harbor',
      },
      topology: {
        edges: [
          {
            from: 'east-harbor',
            to: 'tranquil-fountain',
            cost: 1,
          },
          {
            from: 'tranquil-fountain',
            to: 'ibex-statue',
            cost: 1,
          },
        ],
      },
    })

    expect(() =>
      productionRegionRoutingInput(
        'opening',
        'tranquil-fountain',
      ),
    ).toThrow(/not available/i)
  })

  it('maps production customers to their confirmed home residences', () => {
    expect(
      productionCustomerResidenceById([
        'harry',
        'lizzie',
        'zenobia',
        'daniel',
        'thorsten',
      ]),
    ).toEqual({
      harry: 'east-harbor-residence-8',
      lizzie: 'east-harbor-residence-8',
      zenobia: 'east-harbor-residence-8',
      daniel: 'tranquil-fountain-residence-4',
      thorsten: 'ibex-statue-residence-6',
    })

    expect(() =>
      productionCustomerResidenceById(['unknown-customer']),
    ).toThrow(/Missing residence identity/)
  })
})
