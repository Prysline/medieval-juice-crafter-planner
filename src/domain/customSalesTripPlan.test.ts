import { describe, expect, it } from 'vitest'
import {
  assertCustomSalesTripPlan,
  buildCustomSalesTripBaseline,
  buildCustomSalesTripEditorDraft,
  clearEmptyCustomTripEditorDraftTrips,
  cloneCustomSalesTripPlan,
  customerIdsForCustomTrip,
  customerIdsForCustomTripEditorDraft,
  mergeCustomSalesTrips,
  moveCustomTripCustomers,
  moveCustomTripEditorDraftCustomers,
  moveCustomTripEditorDraftCustomersToNewTrip,
  moveCustomTripCustomersToNewTrip,
  normalizeCustomSalesTripEditorDraft,
  removeEmptyCustomTripEditorDraftTrip,
  reorderCustomSalesTrips,
  swapCustomTripCustomers,
} from './customSalesTripPlan'

function baseline() {
  return buildCustomSalesTripBaseline({
    recipeAssignments: [
      {
        recipeId: 'recipe-a',
        customerIds: ['east-a', 'fountain-a'],
      },
      {
        recipeId: 'recipe-b',
        customerIds: ['east-b', 'ibex-a'],
      },
    ],
    physicalTrips: [
      {
        tripNumber: 1,
        juiceJars: [
          {
            recipeId: 'recipe-a',
            customerIds: ['east-a'],
          },
          {
            recipeId: 'recipe-b',
            customerIds: ['east-b'],
          },
        ],
      },
      {
        tripNumber: 2,
        juiceJars: [
          {
            recipeId: 'recipe-a',
            customerIds: ['fountain-a'],
          },
          {
            recipeId: 'recipe-b',
            customerIds: ['ibex-a'],
          },
        ],
      },
    ],
    customerRegionById: {
      'east-a': 'east-harbor',
      'east-b': 'east-harbor',
      'fountain-a': 'tranquil-fountain',
      'ibex-a': 'ibex-statue',
    },
  })
}

describe('custom sales trip plan', () => {
  it('copies the auto physical grouping while keeping recipe and Region identity fixed', () => {
    const plan = baseline()

    expect(plan.tripOrder).toEqual([
      'auto-trip-1',
      'auto-trip-2',
    ])
    expect(plan.customersById['east-a']).toEqual({
      customerId: 'east-a',
      recipeId: 'recipe-a',
      servings: 1,
      regionId: 'east-harbor',
      residenceId: null,
      routeNodeId: null,
    })
    expect(plan.customersById['ibex-a']).toMatchObject({
      recipeId: 'recipe-b',
      servings: 1,
      regionId: 'ibex-statue',
    })
    expect(
      customerIdsForCustomTrip(plan, 'auto-trip-1'),
    ).toEqual(['east-a', 'east-b'])
    expect(
      customerIdsForCustomTrip(plan, 'auto-trip-2'),
    ).toEqual(['fountain-a', 'ibex-a'])
  })

  it('rejects baseline drift between optimizer recipes and physical loads', () => {
    expect(() =>
      buildCustomSalesTripBaseline({
        recipeAssignments: [
          {
            recipeId: 'recipe-a',
            customerIds: ['east-a'],
          },
        ],
        physicalTrips: [
          {
            tripNumber: 1,
            juiceJars: [
              {
                recipeId: 'recipe-b',
                customerIds: ['east-a'],
              },
            ],
          },
        ],
        customerRegionById: {
          'east-a': 'east-harbor',
        },
      }),
    ).toThrow(/recipe drifted/)
  })

  it('moves arbitrary customers without changing their recipe assignments', () => {
    const plan = baseline()
    const moved = moveCustomTripCustomers(
      plan,
      ['fountain-a'],
      'auto-trip-1',
    )

    expect(moved.tripOrder).toEqual(plan.tripOrder)
    expect(moved.tripByCustomerId['fountain-a']).toBe(
      'auto-trip-1',
    )
    expect(moved.customersById['fountain-a']?.recipeId).toBe(
      'recipe-a',
    )
    expect(plan.tripByCustomerId['fountain-a']).toBe(
      'auto-trip-2',
    )
  })

  it('deletes a source trip when its last customers move away without renumbering the target ID', () => {
    const plan = baseline()
    const moved = moveCustomTripCustomers(
      plan,
      ['east-a', 'east-b'],
      'auto-trip-2',
    )

    expect(moved.tripOrder).toEqual(['auto-trip-2'])
    expect(
      Object.values(moved.tripByCustomerId),
    ).toEqual([
      'auto-trip-2',
      'auto-trip-2',
      'auto-trip-2',
      'auto-trip-2',
    ])
  })


  it('keeps an emptied source trip only in the editor draft until execution normalization', () => {
    const draft = buildCustomSalesTripEditorDraft(baseline())
    const moved = moveCustomTripEditorDraftCustomers(
      draft,
      ['east-a', 'east-b'],
      'auto-trip-2',
    )

    expect(moved.editorTripOrder).toEqual([
      'auto-trip-1',
      'auto-trip-2',
    ])
    expect(
      customerIdsForCustomTripEditorDraft(
        moved,
        'auto-trip-1',
      ),
    ).toEqual([])
    expect(
      Object.values(moved.tripByCustomerId),
    ).toEqual([
      'auto-trip-2',
      'auto-trip-2',
      'auto-trip-2',
      'auto-trip-2',
    ])

    const normalized =
      normalizeCustomSalesTripEditorDraft(moved)
    expect(normalized.tripOrder).toEqual(['auto-trip-2'])
    expect(Object.keys(normalized.customersById).sort()).toEqual(
      Object.keys(normalized.tripByCustomerId).sort(),
    )
  })

  it('removes one empty editor placeholder but refuses to remove a non-empty trip', () => {
    const draft = buildCustomSalesTripEditorDraft(baseline())
    const moved = moveCustomTripEditorDraftCustomers(
      draft,
      ['east-a', 'east-b'],
      'auto-trip-2',
    )
    const removed = removeEmptyCustomTripEditorDraftTrip(
      moved,
      'auto-trip-1',
    )

    expect(removed.editorTripOrder).toEqual(['auto-trip-2'])
    expect(() =>
      removeEmptyCustomTripEditorDraftTrip(
        draft,
        'auto-trip-1',
      ),
    ).toThrow(/cannot be removed while it has customers/)
  })

  it('clears every empty editor placeholder without changing customer assignments', () => {
    const draft = buildCustomSalesTripEditorDraft(baseline())
    const firstMove = moveCustomTripEditorDraftCustomers(
      draft,
      ['east-a', 'east-b'],
      'auto-trip-2',
    )
    const secondMove =
      moveCustomTripEditorDraftCustomersToNewTrip(
        firstMove,
        ['east-a', 'east-b', 'fountain-a', 'ibex-a'],
        'custom-trip-3',
        'auto-trip-2',
      )
    const cleared =
      clearEmptyCustomTripEditorDraftTrips(secondMove)

    expect(secondMove.editorTripOrder).toEqual([
      'auto-trip-1',
      'auto-trip-2',
      'custom-trip-3',
    ])
    expect(cleared.editorTripOrder).toEqual(['custom-trip-3'])
    expect(cleared.tripByCustomerId).toEqual(
      secondMove.tripByCustomerId,
    )
  })

  it('creates a stable new trip immediately after the chosen insertion point', () => {
    const plan = baseline()
    const moved = moveCustomTripCustomersToNewTrip(
      plan,
      ['east-a'],
      'custom-trip-3',
      'auto-trip-1',
    )

    expect(moved.tripOrder).toEqual([
      'auto-trip-1',
      'custom-trip-3',
      'auto-trip-2',
    ])
    expect(moved.tripByCustomerId['east-a']).toBe(
      'custom-trip-3',
    )
  })

  it('keeps the new trip when the insertion-point trip becomes empty and removes only the empty source', () => {
    const plan = baseline()
    const moved = moveCustomTripCustomersToNewTrip(
      plan,
      ['east-a', 'east-b'],
      'custom-trip-3',
      'auto-trip-1',
    )

    expect(moved.tripOrder).toEqual([
      'custom-trip-3',
      'auto-trip-2',
    ])
    expect(
      customerIdsForCustomTrip(moved, 'custom-trip-3'),
    ).toEqual(['east-a', 'east-b'])
  })

  it('atomically swaps two customers between trips without changing other assignments or trip order', () => {
    const plan = baseline()
    const swapped = swapCustomTripCustomers(
      plan,
      'east-a',
      'fountain-a',
    )

    expect(swapped.tripOrder).toEqual(plan.tripOrder)
    expect(swapped.tripByCustomerId).toEqual({
      'east-a': 'auto-trip-2',
      'east-b': 'auto-trip-1',
      'fountain-a': 'auto-trip-1',
      'ibex-a': 'auto-trip-2',
    })
    expect(swapped.customersById).toBe(plan.customersById)
    expect(plan.tripByCustomerId['east-a']).toBe('auto-trip-1')
    expect(plan.tripByCustomerId['fountain-a']).toBe('auto-trip-2')
  })

  it('treats a two-customer swap inside the same trip as a no-op', () => {
    const plan = baseline()
    const swapped = swapCustomTripCustomers(
      plan,
      'east-a',
      'east-b',
    )

    expect(swapped).toBe(plan)
  })

  it('merges a whole trip using the same customer-move semantics', () => {
    const plan = baseline()
    const merged = mergeCustomSalesTrips(
      plan,
      'auto-trip-2',
      'auto-trip-1',
    )

    expect(merged.tripOrder).toEqual(['auto-trip-1'])
    expect(
      customerIdsForCustomTrip(merged, 'auto-trip-1'),
    ).toHaveLength(4)
  })

  it('reorders trips without changing stable IDs or customer assignments', () => {
    const plan = baseline()
    const reordered = reorderCustomSalesTrips(plan, [
      'auto-trip-2',
      'auto-trip-1',
    ])

    expect(reordered.tripOrder).toEqual([
      'auto-trip-2',
      'auto-trip-1',
    ])
    expect(reordered.tripByCustomerId).toEqual(
      plan.tripByCustomerId,
    )
  })

  it('rejects malformed plans with empty real trips', () => {
    expect(() =>
      assertCustomSalesTripPlan({
        customersById: {
          'east-a': {
            customerId: 'east-a',
            recipeId: 'recipe-a',
            servings: 1,
            regionId: 'east-harbor',
          },
        },
        tripByCustomerId: {
          'east-a': 'trip-a',
        },
        tripOrder: ['trip-a', 'trip-empty'],
      }),
    ).toThrow(/cannot be empty/)
  })

  it('clones a draft without sharing editable plan containers', () => {
    const plan = baseline()
    const clone = cloneCustomSalesTripPlan(plan)

    expect(clone).toEqual(plan)
    expect(clone).not.toBe(plan)
    expect(clone.customersById).not.toBe(plan.customersById)
    expect(clone.tripByCustomerId).not.toBe(
      plan.tripByCustomerId,
    )
    expect(clone.tripOrder).not.toBe(plan.tripOrder)
  })
})
