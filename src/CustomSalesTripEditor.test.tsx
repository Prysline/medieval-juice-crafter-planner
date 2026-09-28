import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CustomSalesTripEditor,
  buildCustomTripEditorGroups,
  customTripPlanFingerprint,
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
              },
            ],
          },
        ],
      },
    ])
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
    expect(html).toContain('還原自動方案')
    expect(html).toContain('移到既有趟次')
    expect(html).toContain('移到新趟')
    expect(html).toContain('上移')
    expect(html).toContain('下移')
    expect(html).toContain('併入上一趟')
    expect(html).toContain('併入下一趟')
    expect(html).toContain('拖曳調整趟次順序')
    expect(html).toContain('配方 recipe-a')
    expect(html).toContain('地區 east-harbor')
    expect(html).toContain('顧客 east-a')
    expect(html).toContain('draggable="true"')
    expect(html).not.toContain('完成自訂')
    expect(html).toContain('正式販售排程仍維持自動方案')
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
