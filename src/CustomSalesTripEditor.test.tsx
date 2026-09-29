import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CustomSalesTripEditor,
  buildCustomTripEditorGroups,
  customTripPlanFingerprint,
  moveCustomTripSelectionToAdjacentTrip,
  updatedCustomTripSelection,
} from './CustomSalesTripEditor'
import {
  buildCustomSalesTripBaseline,
  moveCustomTripCustomers,
} from './domain/customSalesTripPlan'

function baseline() {
  return buildCustomSalesTripBaseline({
    recipeAssignments: [
      {
        recipeId: 'recipe-a',
        customerIds: ['east-a', 'east-b', 'fountain-a'],
      },
      {
        recipeId: 'recipe-b',
        customerIds: ['ibex-a'],
      },
    ],
    physicalTrips: [
      {
        tripNumber: 1,
        juiceJars: [
          {
            recipeId: 'recipe-a',
            customerIds: ['east-a', 'east-b'],
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
    customerResidenceById: {
      'east-a': 'east-harbor-residence-1',
      'east-b': 'east-harbor-residence-1',
      'fountain-a': 'tranquil-fountain-residence-1',
      'ibex-a': 'ibex-statue-residence-1',
    },
  })
}

describe('custom sales trip editor grouping', () => {
  it('keeps trip → recipe → Region → customer identity visible', () => {
    const groups = buildCustomTripEditorGroups(baseline())

    expect(groups).toEqual([
      {
        tripId: 'auto-trip-1',
        displayNumber: 1,
        customerIds: ['east-a', 'east-b'],
        recipes: [
          {
            recipeId: 'recipe-a',
            customerIds: ['east-a', 'east-b'],
            regions: [
              {
                regionId: 'east-harbor',
                customerIds: ['east-a', 'east-b'],
                residences: [
                  {
                    residenceId: 'east-harbor-residence-1',
                    customerIds: ['east-a', 'east-b'],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        tripId: 'auto-trip-2',
        displayNumber: 2,
        customerIds: ['fountain-a', 'ibex-a'],
        recipes: [
          {
            recipeId: 'recipe-a',
            customerIds: ['fountain-a'],
            regions: [
              {
                regionId: 'tranquil-fountain',
                customerIds: ['fountain-a'],
                residences: [
                  {
                    residenceId: 'tranquil-fountain-residence-1',
                    customerIds: ['fountain-a'],
                  },
                ],
              },
            ],
          },
          {
            recipeId: 'recipe-b',
            customerIds: ['ibex-a'],
            regions: [
              {
                regionId: 'ibex-statue',
                customerIds: ['ibex-a'],
                residences: [
                  {
                    residenceId: 'ibex-statue-residence-1',
                    customerIds: ['ibex-a'],
                  },
                ],
              },
            ],
          },
        ],
      },
    ])
  })

  it('orders same-recipe same-residence customers by canonical game order without changing the trip assignment', () => {
    const plan = buildCustomSalesTripBaseline({
      recipeAssignments: [
        {
          recipeId: 'recipe-a',
          customerIds: ['zenobia', 'harry', 'lizzie'],
        },
      ],
      physicalTrips: [
        {
          tripNumber: 1,
          juiceJars: [
            {
              recipeId: 'recipe-a',
              customerIds: ['zenobia', 'harry', 'lizzie'],
            },
          ],
        },
      ],
      customerRegionById: {
        zenobia: 'east-harbor',
        harry: 'east-harbor',
        lizzie: 'east-harbor',
      },
      customerResidenceById: {
        zenobia: 'east-harbor-residence-8',
        harry: 'east-harbor-residence-8',
        lizzie: 'east-harbor-residence-8',
      },
    })

    const groups = buildCustomTripEditorGroups(plan)

    expect(groups[0]?.recipes[0]?.regions[0]).toMatchObject({
      customerIds: ['harry', 'lizzie', 'zenobia'],
      residences: [
        {
          residenceId: 'east-harbor-residence-8',
          customerIds: ['harry', 'lizzie', 'zenobia'],
        },
      ],
    })
    expect(plan.tripByCustomerId).toEqual({
      zenobia: 'auto-trip-1',
      harry: 'auto-trip-1',
      lizzie: 'auto-trip-1',
    })
  })

  it('keeps recipe and residence boundaries separate while exposing exact group membership', () => {
    const plan = buildCustomSalesTripBaseline({
      recipeAssignments: [
        {
          recipeId: 'recipe-a',
          customerIds: ['harry', 'lizzie', 'betsy'],
        },
        {
          recipeId: 'recipe-b',
          customerIds: ['zenobia'],
        },
      ],
      physicalTrips: [
        {
          tripNumber: 1,
          juiceJars: [
            {
              recipeId: 'recipe-a',
              customerIds: ['harry', 'lizzie', 'betsy'],
            },
            {
              recipeId: 'recipe-b',
              customerIds: ['zenobia'],
            },
          ],
        },
      ],
      customerRegionById: {
        harry: 'east-harbor',
        lizzie: 'east-harbor',
        betsy: 'east-harbor',
        zenobia: 'east-harbor',
      },
      customerResidenceById: {
        harry: 'east-harbor-residence-8',
        lizzie: 'east-harbor-residence-8',
        betsy: 'east-harbor-residence-9',
        zenobia: 'east-harbor-residence-8',
      },
    })

    const recipes = buildCustomTripEditorGroups(plan)[0]!.recipes

    expect(recipes[0]!.regions[0]!.residences).toEqual([
      {
        residenceId: 'east-harbor-residence-8',
        customerIds: ['harry', 'lizzie'],
      },
      {
        residenceId: 'east-harbor-residence-9',
        customerIds: ['betsy'],
      },
    ])
    expect(recipes[1]!.regions[0]!.residences).toEqual([
      {
        residenceId: 'east-harbor-residence-8',
        customerIds: ['zenobia'],
      },
    ])
  })

  it('selects only the requested residence group or individual customer', () => {
    const residenceCustomerIds =
      buildCustomTripEditorGroups(baseline())[0]!
        .recipes[0]!.regions[0]!.residences[0]!.customerIds

    const groupSelection = updatedCustomTripSelection(
      new Set<string>(),
      residenceCustomerIds,
      true,
    )
    expect([...groupSelection]).toEqual(['east-a', 'east-b'])
    expect(groupSelection.has('fountain-a')).toBe(false)

    const individualSelection = updatedCustomTripSelection(
      groupSelection,
      ['east-a'],
      false,
    )
    expect(individualSelection.has('east-a')).toBe(false)
    expect(individualSelection.has('east-b')).toBe(true)
  })

  it('moves only the selected resident to an adjacent trip, even when a same-recipe same-residence resident remains behind', () => {
    const initial = baseline()
    const moved = moveCustomTripSelectionToAdjacentTrip(
      initial,
      ['east-a'],
      1,
    )

    expect(moved.tripByCustomerId['east-a']).toBe('auto-trip-2')
    expect(moved.tripByCustomerId['east-b']).toBe('auto-trip-1')
    expect(moved.customersById['east-a']?.recipeId).toBe('recipe-a')
    expect(moved.customersById['east-b']?.recipeId).toBe('recipe-a')
  })

  it('does not apply an adjacent-trip command when the selection spans multiple source trips', () => {
    const initial = baseline()
    const moved = moveCustomTripSelectionToAdjacentTrip(
      initial,
      ['east-a', 'fountain-a'],
      1,
    )

    expect(moved).toBe(initial)
  })

  it('changes the draft fingerprint when customer → trip assignment changes', () => {
    const initial = baseline()
    const moved = moveCustomTripCustomers(
      initial,
      ['east-b'],
      'auto-trip-2',
    )

    expect(customTripPlanFingerprint(moved)).not.toBe(
      customTripPlanFingerprint(initial),
    )
    expect(moved.customersById['east-b']?.recipeId).toBe('recipe-a')
  })
})

describe('custom sales trip editor UI', () => {
  it('renders explicit mobile actions, group selection, and desktop drag affordances', () => {
    const html = renderToStaticMarkup(
      <CustomSalesTripEditor
        autoBaseline={baseline()}
        validateDraft={() => ({
          status: 'invalid',
          salesPlan: null,
          issues: [
            {
              category: 'physical-realization',
              tripId: 'auto-trip-2',
              recipeId: 'recipe-a',
              message: '測試不可行',
              suggestions: [],
            },
          ],
        })}
        customerLabel={(customerId) => '顧客 ' + customerId}
        recipeLabel={(recipeId) => '配方 ' + recipeId}
        regionLabel={(regionId) => '地區 ' + regionId}
        defaultOpen
      />,
    )

    expect(html).toContain('自訂販售趟次')
    expect(html).toContain('將草稿還原為自動方案')
    expect(html).toContain('居民操作 · 已選擇 0 位')
    expect(html).toContain('移到上一趟')
    expect(html).toContain('移到下一趟')
    expect(html).toContain('指定趟次')
    expect(html).toContain('移到指定趟')
    expect(html).toContain('移到新趟')
    expect(html).toContain('與上一趟交換')
    expect(html).toContain('與下一趟交換')
    expect(html).not.toContain('>上移<')
    expect(html).not.toContain('>下移<')
    expect(html).toContain('併入上一趟')
    expect(html).toContain('併入下一趟')
    expect(html).toContain('整趟操作 · 拖曳整趟調整順序')
    expect(html).toContain('配方 recipe-a')
    expect(html).toContain('地區 east-harbor')
    expect(html).toContain('住處 1')
    expect(html).toContain('aria-label="住處 1整組選取"')
    expect(html).toContain('aria-label="顧客 east-a單人選取"')
    expect(html).toContain('class="optimizer-custom-residence-group"')
    expect(html).toContain('顧客 east-a')
    expect(html).toContain('draggable="true"')
    expect(html).not.toContain('完成自訂')
    expect(html).toContain('正式販售排程仍維持自動方案')
  })

  it('starts later edits from the applied custom plan and exposes completion only when integration supplies an accept action', () => {
    const applied = moveCustomTripCustomers(
      baseline(),
      ['east-b'],
      'auto-trip-2',
    )
    const html = renderToStaticMarkup(
      <CustomSalesTripEditor
        autoBaseline={baseline()}
        appliedPlan={applied}
        validateDraft={() => ({
          status: 'valid',
          salesPlan: {} as never,
          issues: [],
        })}
        customerLabel={(customerId) => customerId}
        recipeLabel={(recipeId) => recipeId}
        regionLabel={(regionId) => regionId}
        onAcceptValidatedDraft={() => {}}
      />,
    )

    expect(html).toContain('目前使用自訂方案')
    expect(html).toContain('編輯自訂趟次')
    expect(html).not.toContain('開始自訂趟次')
  })

  it('keeps an applied custom plan active while editing and exposes an explicit auto-plan restore action', () => {
    const applied = moveCustomTripCustomers(
      baseline(),
      ['east-b'],
      'auto-trip-2',
    )
    const html = renderToStaticMarkup(
      <CustomSalesTripEditor
        autoBaseline={baseline()}
        appliedPlan={applied}
        validateDraft={() => ({
          status: 'valid',
          salesPlan: {} as never,
          issues: [],
        })}
        customerLabel={(customerId) => customerId}
        recipeLabel={(recipeId) => recipeId}
        regionLabel={(regionId) => regionId}
        defaultOpen
        onRestoreAutoPlan={() => {}}
        onAcceptValidatedDraft={() => {}}
      />,
    )

    expect(html).toContain('目前已完成的自訂方案仍維持生效')
    expect(html).toContain('將草稿還原為自動方案')
    expect(html).toContain('改回自動方案')
    expect(html).not.toContain('目前正式販售排程仍維持自動方案')
  })

  it('keeps the entry collapsed until the player chooses to edit', () => {
    const html = renderToStaticMarkup(
      <CustomSalesTripEditor
        autoBaseline={baseline()}
        validateDraft={() => ({
          status: 'invalid',
          salesPlan: null,
          issues: [],
        })}
        customerLabel={(customerId) => customerId}
        recipeLabel={(recipeId) => recipeId}
        regionLabel={(regionId) => regionId}
      />,
    )

    expect(html).toContain('開始自訂趟次')
    expect(html).not.toContain('還原自動方案')
  })
})
