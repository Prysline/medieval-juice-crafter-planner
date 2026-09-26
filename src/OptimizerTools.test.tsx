import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { InventoryState } from './types'
import {
  buildMultiTripReplenishmentPlan,
  type MultiTripProductionJarFill,
} from './domain/multiTripReplenishment'
import type { OptimizationResult } from './domain/optimizer'
import type { PreparationDemand } from './domain/preparationDemand'
import { buildPreparationShortfall } from './domain/preparationShortfall'
import { buildRegionPhysicalSalesPlan } from './domain/regionPhysicalSalesPlanner'
import { buildRemainingSalesTripPlan } from './domain/remainingSalesTripPlanner'
import type {
  DeliveryExecutionCursor,
  DeliveryExecutionPlan,
} from './domain/deliveryExecution'
import type { PlanApplicationTransactionDraft } from './domain/planApplicationTransaction'
import {
  DeliveryCustomerCheckbox,
  DeliveryRecipeGroupCheckbox,
  DeliveryTripGroupCheckbox,
  INVENTORY_RECIPE_SEARCH_RESULT_LIMIT,
  INTERMEDIATE_JUICE_SEARCH_RESULT_LIMIT,
  JuiceJarRecipeCombobox,
  MachineBatchFlow,
  ProductionStepFinalJuiceNote,
  SeasoningStageMaterialSummary,
  SeasoningStepStageUsageNote,
  OptimizerSummaryMetrics,
  PlanApplicationPreview,
  PlanningErrorBlock,
  RemainingSalesTripPlanBlock,
  SalesTripPlanBlock,
  criterionLabel,
  customerIdsInPlannedTripOrder,
  recipePlansInPlannedTripOrder,
  recipePreparationSourceSummary,
  deliveryCanonicalSyncStatus,
  deliveryCustomerControlState,
  deliveryRecipeGroupControlState,
  moveInventoryRecipeSearchIndex,
  optimizerCriterionOptions,
  optimizerInventoryIngredients,
  intermediateJuiceInventoryEntries,
  searchIntermediateJuiceEntries,
  searchInventoryRecipeEntries,
} from './OptimizerTools'
import {
  PlanningUserError,
  presentPlanningError,
} from './domain/planningErrors'
import {
  buildRecipeCandidatePool,
  recipeCandidateEntriesForInventoryEditor,
} from './domain/recipeCandidatePool'

function transactionDraft(): PlanApplicationTransactionDraft {
  return {
    schemaVersion: 'plan-application-v1',
    before: {
      inventory: {
        ingredientUnits: { lemon: 3 },
        intermediateJuiceUnits: {},
        waterUnits: 4,
        cleanCups: 2,
        usedCups: 1,
        juiceJars: [
          {
            id: 'jar-1',
            recipeId: 'lemon-juice',
            servings: 2,
          },
        ],
        shelfCount: 1,
        jarRackCount: 1,
      },
      currentProgress: 'opening',
      satisfactionByVillage: {
        'east-harbor': 0,
        'tranquil-fountain': 0,
        'ibex-statue': 0,
      },
      formalCustomerIds: ['jack'],
      suppliedCustomerIds: [],
      plannerSettings: {
        juiceJarCarryMode: 'fixed-slots',
        reservedJuiceJarSlots: 1,
        allowUsedCupDropIfFull: false,
        allowDiscardRetainedJuice: false,
      },
    },
    after: {
      inventory: {
        ingredientUnits: { lemon: 2 },
        intermediateJuiceUnits: {},
        waterUnits: 2,
        cleanCups: 0,
        usedCups: 3,
        juiceJars: [
          {
            id: 'jar-1',
            recipeId: 'orange-juice',
            servings: 1,
          },
        ],
        shelfCount: 1,
        jarRackCount: 1,
      },
      currentProgress: 'opening',
      satisfactionByVillage: {
        'east-harbor': 0,
        'tranquil-fountain': 0,
        'ibex-statue': 0,
      },
      formalCustomerIds: ['jack'],
      suppliedCustomerIds: ['jack'],
      plannerSettings: {
        juiceJarCarryMode: 'fixed-slots',
        reservedJuiceJarSlots: 1,
        allowUsedCupDropIfFull: false,
        allowDiscardRetainedJuice: false,
      },
    },
    changes: {
      intermediateJuice: [],
      ingredients: [
        {
          ingredientId: 'lemon',
          beforeUnits: 3,
          afterUnits: 2,
          consumedFromInventory: 1,
          acquiredAndConsumedUnits: 0,
        },
      ],
      water: {
        beforeUnits: 4,
        afterUnits: 2,
        consumedFromInventory: 2,
        productionUnitsRequired: 1,
        cupWashUnitsRequired: 1,
        externalUnitsRequired: 0,
      },
      cups: {
        cleanBefore: 2,
        cleanAfter: 0,
        usedBefore: 1,
        usedAfter: 3,
        physicalBefore: 3,
        physicalAfter: 3,
        droppedUsedCups: 0,
      },
      juiceJars: [
        {
          physicalJarId: 'jar-1',
          before: {
            id: 'jar-1',
            recipeId: 'lemon-juice',
            servings: 2,
          },
          after: {
            id: 'jar-1',
            recipeId: 'orange-juice',
            servings: 1,
          },
        },
      ],
      discardedJuice: [
        {
          source: 'initial-contents',
          physicalJarId: 'jar-1',
          recipeId: 'lemon-juice',
          servings: 1,
        },
        {
          source: 'new-production-leftover',
          physicalJarId: 'jar-1',
          recipeId: 'orange-juice',
          servings: 1,
          afterTripNumber: 2,
        },
      ],
      newlySuppliedCustomerIds: ['jack'],
    },
  }
}

const fills: MultiTripProductionJarFill[] = [
  {
    physicalJarId: 'jar-1',
    recipeId: 'orange-juice',
    recipeName: '橙汁',
    beforeTripNumber: 2,
    servings: 2,
    servingsAfterFill: 2,
    fillAction: 'type-switch',
    previousRecipeId: 'lemon-juice',
    previousRecipeName: '檸檬汁',
    receiver: 'carried-jar',
  },
]

describe('juice jar recipe search UX', () => {
  it('searches observed, saved-safe scope and safe computed recipes while bounding rendered results', () => {
    const pool = buildRecipeCandidatePool('juice-blender-unlocked')
    const entries = recipeCandidateEntriesForInventoryEditor(pool)
    expect(entries.length).toBeGreaterThan(
      INVENTORY_RECIPE_SEARCH_RESULT_LIMIT,
    )

    const initial = searchInventoryRecipeEntries(entries, '')
    expect(initial).toHaveLength(INVENTORY_RECIPE_SEARCH_RESULT_LIMIT)

    const computed = searchInventoryRecipeEntries(
      entries,
      'lemon pear',
    )
    expect(computed.length).toBeGreaterThan(0)
    expect(
      computed.some(
        (entry) =>
          entry.ingredientIds.join('>') === 'lemon>pear' &&
          entry.sources.includes('computed') &&
          !entry.sources.includes('ambiguous-computed'),
      ),
    ).toBe(true)

    expect(
      searchInventoryRecipeEntries(entries, 'definitely-no-such-recipe'),
    ).toEqual([])
  })

  it('builds raw juice stock directly and gates it by current progress', () => {
    const opening = intermediateJuiceInventoryEntries([], 'opening')
    expect(opening.map((entry) => entry.identity)).toEqual([
      'juice-state:v1:orange',
      'juice-state:v1:lemon',
    ])
    expect(searchIntermediateJuiceEntries(opening, '橙汁')).toEqual([
      expect.objectContaining({ identity: 'juice-state:v1:orange' }),
    ])
    expect(searchIntermediateJuiceEntries(opening, '橙子')).toEqual([
      expect.objectContaining({ identity: 'juice-state:v1:orange' }),
    ])
    expect(searchIntermediateJuiceEntries(opening, 'orange')).toEqual([
      expect.objectContaining({ identity: 'juice-state:v1:orange' }),
    ])
    expect(opening.some((entry) => entry.identity === 'juice-state:v1:banana')).toBe(false)

    const juicer = intermediateJuiceInventoryEntries([], 'juicer-unlocked')
    expect(juicer.some((entry) => entry.identity === 'juice-state:v1:carrot')).toBe(true)
    expect(juicer.some((entry) => entry.identity === 'juice-state:v1:pear')).toBe(true)
    expect(juicer.some((entry) => entry.identity === 'juice-state:v1:banana')).toBe(false)

    const fountain = intermediateJuiceInventoryEntries([], 'tranquil-fountain-unlocked')
    expect(fountain.some((entry) => entry.identity === 'juice-state:v1:banana')).toBe(true)
  })

  it('derives compound intermediate states without treating the final recipe as a separate stock identity', () => {
    const compoundEntry = {
      id: 'compound-intermediate-fixture',
      ingredientIds: ['lemon', 'sugar', 'orange', 'mint'],
      candidate: {
        id: 'compound-intermediate-fixture',
        name: '複合中間果汁測試',
        ingredients: ['檸檬', '糖', '橙子', '薄荷'],
        effects: [],
        equipment: ['柑橘榨汁機', '調味器', '果汁調和器', '果汁成品台'],
        source: 'observed',
        unlockedAt: 'juice-blender-unlocked',
        salePrice: null,
      },
      sources: ['observed'],
      savedRecipeIds: [],
      availableAtCurrentProgress: true,
      inGeneratedSearchScope: false,
    } satisfies ReturnType<typeof recipeCandidateEntriesForInventoryEditor>[number]
    const intermediate = intermediateJuiceInventoryEntries(
      [compoundEntry],
      'juice-blender-unlocked',
    )
    expect(intermediate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identity: 'juice-state:v1:lemon/sugar' }),
        expect.objectContaining({ identity: 'juice-state:v1:orange/mint' }),
      ]),
    )
    expect(
      intermediate.some(
        (entry) =>
          entry.identity === 'juice-state:v1:lemon/sugar/orange/mint',
      ),
    ).toBe(true)
  })

  it('wraps keyboard navigation across the bounded result list', () => {
    expect(moveInventoryRecipeSearchIndex(0, 'next', 3)).toBe(1)
    expect(moveInventoryRecipeSearchIndex(2, 'next', 3)).toBe(0)
    expect(moveInventoryRecipeSearchIndex(0, 'previous', 3)).toBe(2)
    expect(moveInventoryRecipeSearchIndex(1, 'previous', 3)).toBe(0)
    expect(moveInventoryRecipeSearchIndex(4, 'next', 0)).toBe(0)
  })

  it('keeps unknown legacy jar content readable and exposes an explicit clear action', () => {
    const entries = recipeCandidateEntriesForInventoryEditor(
      buildRecipeCandidatePool('opening'),
    )
    const html = renderToStaticMarkup(
      <JuiceJarRecipeCombobox
        jarId="jar-legacy"
        recipeId="legacy:unknown-recipe"
        entries={entries}
        onChange={() => {}}
      />,
    )

    expect(html).toContain('role="combobox"')
    expect(html).toContain('既有內容：legacy:unknown-recipe')
    expect(html).toContain('清空')
    expect(html).not.toContain('<option')
  })
})

function deliveryPlan(): DeliveryExecutionPlan {
  return {
    planFingerprint: 'delivery-ui-plan',
    policy: 'retain-and-wash',
    trips: [
      {
        tripNumber: 1,
        productionFills: [],
        initialJuiceDiscards: [],
        ingredientRequirements: [],
        intermediateRequirements: [],
        productionWaterUnits: 0,
        cupsWashedBeforeTrip: 0,
        cupWashWaterUnits: 0,
        cleanCupsBeforeTrip: 2,
        usedCupsBeforeTrip: 0,
        cleanCupsAfterTrip: 0,
        usedCupsAfterTrip: 2,
        juiceJarSlotsCarried: 1,
        deliveries: [
          {
            customerId: 'jack',
            physicalJarId: 'jar-a',
            recipeId: 'recipe-a',
            recipeName: 'A',
          },
          {
            customerId: 'leticia',
            physicalJarId: 'jar-a',
            recipeId: 'recipe-a',
            recipeName: 'A',
          },
        ],
        newProductionDiscards: [],
      },
      {
        tripNumber: 2,
        productionFills: [],
        initialJuiceDiscards: [],
        ingredientRequirements: [],
        intermediateRequirements: [],
        productionWaterUnits: 0,
        cupsWashedBeforeTrip: 2,
        cupWashWaterUnits: 2,
        cleanCupsBeforeTrip: 0,
        usedCupsBeforeTrip: 2,
        cleanCupsAfterTrip: 0,
        usedCupsAfterTrip: 1,
        juiceJarSlotsCarried: 1,
        deliveries: [
          {
            customerId: 'florida',
            physicalJarId: 'jar-b',
            recipeId: 'recipe-b',
            recipeName: 'B',
          },
        ],
        newProductionDiscards: [],
      },
    ],
    finalCleanCups: 0,
    finalUsedCups: 1,
    finalPhysicalCupCount: 2,
  }
}

function deliveryCursor(
  overrides: Partial<DeliveryExecutionCursor> = {},
): DeliveryExecutionCursor {
  return {
    planFingerprint: 'delivery-ui-plan',
    nextTripNumber: 1,
    tripPrepared: false,
    completedCustomerIdsInTrip: [],
    ...overrides,
  }
}

describe('delivery checklist UI', () => {
  it('keeps recipe grouping while ordering customers by planned trip', () => {
    const plan = deliveryPlan()

    expect(
      customerIdsInPlannedTripOrder(
        ['florida', 'leticia', 'jack'],
        plan,
      ),
    ).toEqual(['leticia', 'jack', 'florida'])

    expect(
      customerIdsInPlannedTripOrder(
        ['unplanned', 'florida', 'jack'],
        plan,
      ),
    ).toEqual(['jack', 'florida', 'unplanned'])
  })

  it('orders recipe groups by their earliest planned trip while preserving stable ties and unplanned groups last', () => {
    const plan = deliveryPlan()
    const recipePlans = [
      { id: 'recipe-b', customerIds: ['florida'] },
      { id: 'unplanned', customerIds: ['unplanned'] },
      { id: 'recipe-a-second', customerIds: ['jack'] },
      { id: 'recipe-a-first', customerIds: ['leticia'] },
    ]

    expect(
      recipePlansInPlannedTripOrder(recipePlans, plan).map(
        (recipePlan) => recipePlan.id,
      ),
    ).toEqual([
      'recipe-a-second',
      'recipe-a-first',
      'recipe-b',
      'unplanned',
    ])
  })

  it('keeps the canonical supplied checklist usable without a physical execution plan', () => {
    expect(
      deliveryCustomerControlState(null, null, [], 'florida'),
    ).toMatchObject({
      status: 'active',
      tripNumber: null,
      physicalJarId: null,
    })

    const html = renderToStaticMarkup(
      <DeliveryCustomerCheckbox
        customerId="florida"
        plan={null}
        cursor={null}
        suppliedCustomerIds={[]}
        onChange={() => {}}
      />,
    )

    expect(html).not.toContain('disabled=""')
    expect(html).toContain('可記錄今日已供應')
  })

  it('shows the canonical customer Region beside delivery checklist names', () => {
    const eastHtml = renderToStaticMarkup(
      <DeliveryCustomerCheckbox
        customerId="jack"
        plan={deliveryPlan()}
        cursor={deliveryCursor()}
        suppliedCustomerIds={[]}
        onChange={() => {}}
      />,
    )
    const fountainHtml = renderToStaticMarkup(
      <DeliveryCustomerCheckbox
        customerId="florida"
        plan={deliveryPlan()}
        cursor={deliveryCursor()}
        suppliedCustomerIds={[]}
        onChange={() => {}}
      />,
    )

    expect(eastHtml).toContain('東港村')
    expect(fountainHtml).toContain('靜謐噴泉')
    expect(eastHtml).toContain('optimizer-customer-region-badge')
  })

  it('lets a trip bulk checkbox share the same supplied-customer authority', () => {
    const plan = deliveryPlan()
    const cursor = deliveryCursor()

    const empty = renderToStaticMarkup(
      <DeliveryTripGroupCheckbox
        tripNumber={1}
        customerIds={['jack', 'leticia']}
        plan={plan}
        cursor={cursor}
        suppliedCustomerIds={[]}
        onChange={() => {}}
      />,
    )
    const partial = renderToStaticMarkup(
      <DeliveryTripGroupCheckbox
        tripNumber={1}
        customerIds={['jack', 'leticia']}
        plan={plan}
        cursor={cursor}
        suppliedCustomerIds={['jack']}
        onChange={() => {}}
      />,
    )
    const complete = renderToStaticMarkup(
      <DeliveryTripGroupCheckbox
        tripNumber={1}
        customerIds={['jack', 'leticia']}
        plan={plan}
        cursor={cursor}
        suppliedCustomerIds={['jack', 'leticia']}
        onChange={() => {}}
      />,
    )

    expect(empty).toContain('完成 0 / 2')
    expect(partial).toContain('aria-checked="mixed"')
    expect(partial).toContain('完成 1 / 2')
    expect(complete).toContain('checked=""')
    expect(complete).toContain('完成 2 / 2')
  })

  it('keeps planned trip metadata without blocking out-of-order delivery checkboxes', () => {
    const plan = deliveryPlan()
    const cursor = deliveryCursor()

    expect(
      deliveryCustomerControlState(plan, cursor, [], 'jack'),
    ).toMatchObject({
      status: 'active',
      tripNumber: 1,
      physicalJarId: 'jar-a',
    })
    expect(
      deliveryCustomerControlState(plan, cursor, [], 'florida'),
    ).toMatchObject({
      status: 'active',
      tripNumber: 2,
      activeTripNumber: 1,
    })

    const activeHtml = renderToStaticMarkup(
      <DeliveryCustomerCheckbox
        customerId="jack"
        plan={plan}
        cursor={cursor}
        suppliedCustomerIds={[]}
        onChange={() => {}}
      />,
    )
    const laterHtml = renderToStaticMarkup(
      <DeliveryCustomerCheckbox
        customerId="florida"
        plan={plan}
        cursor={cursor}
        suppliedCustomerIds={[]}
        onChange={() => {}}
      />,
    )

    expect(activeHtml).toContain('type="checkbox"')
    expect(activeHtml).not.toContain('disabled=""')
    expect(activeHtml).toContain('可依實際送達順序勾選')
    expect(laterHtml).not.toContain('disabled=""')
    expect(laterHtml).toContain('規劃第 2 趟')
  })

  it('lets a recipe heading complete all currently active customers in that recipe', () => {
    const plan = deliveryPlan()
    const cursor = deliveryCursor()

    expect(
      deliveryRecipeGroupControlState(
        plan,
        cursor,
        [],
        ['jack', 'leticia'],
      ),
    ).toEqual({
      checked: false,
      partial: false,
      canCommit: true,
      pendingCustomerIds: ['jack', 'leticia'],
    })

    const html = renderToStaticMarkup(
      <DeliveryRecipeGroupCheckbox
        recipeName="A"
        customerIds={['jack', 'leticia']}
        plan={plan}
        cursor={cursor}
        suppliedCustomerIds={[]}
        onChange={() => {}}
      />,
    )

    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('A')
    expect(html).toContain('A整組交付完成')
  })

  it('shows recipe completion as mixed when canonical supplied state contains only some assigned customers', () => {
    const plan = deliveryPlan()
    const cursor = deliveryCursor({
      tripPrepared: true,
      completedCustomerIdsInTrip: ['jack'],
    })

    expect(
      deliveryRecipeGroupControlState(
        plan,
        cursor,
        ['jack'],
        ['jack', 'leticia'],
      ),
    ).toEqual({
      checked: false,
      partial: true,
      canCommit: true,
      pendingCustomerIds: ['leticia'],
    })

    const html = renderToStaticMarkup(
      <DeliveryRecipeGroupCheckbox
        recipeName="A"
        customerIds={['jack', 'leticia']}
        plan={plan}
        cursor={cursor}
        suppliedCustomerIds={['jack']}
        onChange={() => {}}
      />,
    )

    expect(html).toContain('aria-checked="mixed"')
    expect(html).toContain('optimizer-delivery-recipe-group partial')
  })

  it('does not infer recipe completion from an advanced physical cursor', () => {
    const plan = deliveryPlan()
    const cursor = deliveryCursor({
      nextTripNumber: 2,
      tripPrepared: false,
      completedCustomerIdsInTrip: [],
    })

    expect(
      deliveryRecipeGroupControlState(
        plan,
        cursor,
        [],
        ['jack', 'leticia'],
      ),
    ).toEqual({
      checked: false,
      partial: false,
      canCommit: true,
      pendingCustomerIds: ['jack', 'leticia'],
    })

    const html = renderToStaticMarkup(
      <DeliveryRecipeGroupCheckbox
        recipeName="A"
        customerIds={['jack', 'leticia']}
        plan={plan}
        cursor={cursor}
        suppliedCustomerIds={[]}
        onChange={() => {}}
      />,
    )

    expect(html).not.toContain('checked=""')
    expect(html).not.toContain('disabled=""')
  })

  it('lets a recipe group record customers spanning multiple planned trips', () => {
    const plan = deliveryPlan()
    const cursor = deliveryCursor()

    expect(
      deliveryRecipeGroupControlState(
        plan,
        cursor,
        [],
        ['jack', 'florida'],
      ),
    ).toEqual({
      checked: false,
      partial: false,
      canCommit: true,
      pendingCustomerIds: ['jack', 'florida'],
    })

    const html = renderToStaticMarkup(
      <DeliveryRecipeGroupCheckbox
        recipeName="跨趟配方"
        customerIds={['jack', 'florida']}
        plan={plan}
        cursor={cursor}
        suppliedCustomerIds={[]}
        onChange={() => {}}
      />,
    )

    expect(html).not.toContain('disabled=""')
  })

  it('does not infer canonical delivery from the physical cursor', () => {
    const plan = deliveryPlan()
    const cursor = deliveryCursor({
      tripPrepared: true,
      completedCustomerIdsInTrip: ['jack'],
    })

    expect(
      deliveryCustomerControlState(plan, cursor, [], 'jack').status,
    ).toBe('active')

    const html = renderToStaticMarkup(
      <DeliveryCustomerCheckbox
        customerId="jack"
        plan={plan}
        cursor={cursor}
        suppliedCustomerIds={[]}
        onChange={() => {}}
      />,
    )

    expect(html).not.toContain('checked=""')
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('可依實際送達順序勾選')
  })

  it('treats canonical supplied-customer state as the same committed delivery authority', () => {
    const plan = deliveryPlan()
    const cursor = deliveryCursor()

    expect(
      deliveryCustomerControlState(
        plan,
        cursor,
        ['jack'],
        'jack',
      ).status,
    ).toBe('committed')

    const html = renderToStaticMarkup(
      <DeliveryCustomerCheckbox
        customerId="jack"
        plan={plan}
        cursor={cursor}
        suppliedCustomerIds={['jack']}
        onChange={() => {}}
      />,
    )

    expect(html).toContain('checked=""')
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('已記錄今日供應')
  })


  it('keeps a supplied customer checkbox enabled so unchecking can correct only the supplied record', () => {
    const plan = deliveryPlan()
    const cursor = deliveryCursor({
      nextTripNumber: 2,
      tripPrepared: true,
      completedCustomerIdsInTrip: ['jack'],
    })
    const html = renderToStaticMarkup(
      <DeliveryCustomerCheckbox
        customerId="jack"
        plan={plan}
        cursor={cursor}
        suppliedCustomerIds={['jack']}
        onChange={() => {}}
      />,
    )

    expect(html).toContain('checked=""')
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('已記錄今日供應')
  })

  it('keeps a fully supplied recipe group enabled so the whole record can be unchecked across planned trips', () => {
    const plan = deliveryPlan()
    const cursor = deliveryCursor({ nextTripNumber: 2 })
    const html = renderToStaticMarkup(
      <DeliveryRecipeGroupCheckbox
        recipeName="跨趟配方"
        customerIds={['jack', 'florida']}
        plan={plan}
        cursor={cursor}
        suppliedCustomerIds={['jack', 'florida']}
        onChange={() => {}}
      />,
    )

    expect(html).toContain('checked=""')
    expect(html).not.toContain('disabled=""')
  })
  it('keeps earlier planned-trip customers active until canonical supplied state records them', () => {
    const plan = deliveryPlan()
    const cursor = deliveryCursor({
      nextTripNumber: 2,
      tripPrepared: false,
      completedCustomerIdsInTrip: [],
    })

    expect(
      deliveryCustomerControlState(plan, cursor, [], 'leticia').status,
    ).toBe('active')
    expect(
      deliveryCustomerControlState(plan, cursor, [], 'florida').status,
    ).toBe('active')
  })

  it('preserves the result only across expected self-commit canonical sync states', () => {
    const guard = {
      allowedFingerprints: [
        'before-before',
        'after-before',
        'before-after',
        'after-after',
      ],
      targetFingerprint: 'after-after',
    }

    expect(
      deliveryCanonicalSyncStatus(guard, 'before-before'),
    ).toBe('pending')
    expect(
      deliveryCanonicalSyncStatus(guard, 'after-before'),
    ).toBe('pending')
    expect(
      deliveryCanonicalSyncStatus(guard, 'after-after'),
    ).toBe('complete')
    expect(
      deliveryCanonicalSyncStatus(guard, 'external-change'),
    ).toBe('unexpected')
  })
})

describe('production checklist UI', () => {
  it('renders each machine batch as an independently checkable completed step', () => {
    const html = renderToStaticMarkup(
      <MachineBatchFlow
        step={{
          key: 'juice:lemon',
          kind: 'juicing',
          equipment: '柑橘榨汁機',
          fromIngredientIds: [],
          toIngredientIds: ['lemon'],
          addedIngredientId: 'lemon',
          quantity: 5,
          operationCount: 1,
          recipeIds: ['recipe-lemon'],
        }}
        quantity={5}
        batchIndex={0}
        completed={true}
        onCompletedChange={() => {}}
      />,
    )

    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked=""')
    expect(html).toContain('optimizer-operation-flow completed')
    expect(html).toContain('第 1 批')
    expect(html).toContain('檸檬 ×5')
    expect(html).toContain('檸檬原汁 ×5')
  })

  it('labels final juice produced by seasoning or blending before finalizing', () => {
    const seasoningHtml = renderToStaticMarkup(
      <ProductionStepFinalJuiceNote
        stepKind="seasoning"
        readyForFinalizingUnits={3}
      />,
    )
    const blendingHtml = renderToStaticMarkup(
      <ProductionStepFinalJuiceNote
        stepKind="blending"
        readyForFinalizingUnits={2}
      />,
    )
    const hiddenHtml = renderToStaticMarkup(
      <ProductionStepFinalJuiceNote
        stepKind="seasoning"
        readyForFinalizingUnits={0}
      />,
    )

    expect(seasoningHtml).toContain(
      '其中 3 份為最終果汁（下一步進果汁成品台）',
    )
    expect(blendingHtml).toContain(
      '其中 2 份為最終果汁（下一步進果汁成品台）',
    )
    expect(hiddenHtml).toBe('')
  })

  it('renders seasoning materials and only the base juices needed in that stage', () => {
    const html = renderToStaticMarkup(
      <SeasoningStageMaterialSummary
        ingredientUnits={{ mint: 8, sugar: 3, cinnamon: 5 }}
        baseJuiceUnits={{ lemon: 12, orange: 4 }}
      />,
    )

    expect(html).toContain('本階段材料：')
    expect(html).toContain('薄荷 ×8')
    expect(html).toContain('糖 ×3')
    expect(html).toContain('肉桂 ×5')
    expect(html).toContain('本階段基礎果汁：')
    expect(html).toContain('檸檬原汁 ×12')
    expect(html).toContain('橙子原汁 ×4')
  })


  it('shows which seasoning output must stay carried and which can be racked', () => {
    const mixed = renderToStaticMarkup(
      <SeasoningStepStageUsageNote
        quantity={8}
        stillNeededUnits={5}
      />,
    )
    const releaseAll = renderToStaticMarkup(
      <SeasoningStepStageUsageNote
        quantity={3}
        stillNeededUnits={0}
      />,
    )

    expect(mixed).toContain('本階段還會用到 5 份')
    expect(mixed).toContain('本階段不再使用 3 份，可先放架上')
    expect(releaseAll).not.toContain('本階段還會用到')
    expect(releaseAll).toContain(
      '本階段不再使用 3 份，可先放架上',
    )
  })

})

describe('optimizer inventory availability', () => {
  it('hides tranquil-fountain ingredients until that milestone is unlocked', () => {
    expect(
      optimizerInventoryIngredients('seasoner-unlocked').map(
        (ingredient) => ingredient.id,
      ),
    ).not.toContain('cinnamon')
    expect(
      optimizerInventoryIngredients('seasoner-unlocked').map(
        (ingredient) => ingredient.id,
      ),
    ).not.toContain('banana')

    expect(
      optimizerInventoryIngredients('tranquil-fountain-unlocked').map(
        (ingredient) => ingredient.id,
      ),
    ).toEqual(expect.arrayContaining(['cinnamon', 'banana']))
  })

  it('exposes the confirmed ibex-statue ingredient catalog only after the region milestone', () => {
    const before = optimizerInventoryIngredients(
      'advanced-citrus-juicer-unlocked',
    ).map((ingredient) => ingredient.id)
    const after = optimizerInventoryIngredients(
      'ibex-statue-unlocked',
    ).map((ingredient) => ingredient.id)

    expect(before).not.toEqual(
      expect.arrayContaining(['peach', 'cucumber', 'tomato', 'clove']),
    )
    expect(after).toEqual(
      expect.arrayContaining(['peach', 'cucumber', 'tomato', 'clove']),
    )
  })
})

describe('optimizer summary', () => {
  it('shows physical terminal leftovers when the optimizer gross result reports zero', () => {
    const result: OptimizationResult = {
      assignments: [],
      recipePlans: [],
      productionSteps: [],
      machineOperations: {
        total: 0,
        juicing: 0,
        seasoning: 0,
        blending: 0,
        finalizing: 0,
      },
      jarTypeSwitches: 0,
      availableJuiceJarCount: 2,
      shoppingList: [],
      unresolvedCustomers: [],
      totalIngredientCost: 0,
      knownSalesRevenue: 0,
      knownGrossProfit: 0,
      formalSalesCount: 0,
      potentialTrialCount: 0,
      unknownFormalSalePriceCount: 0,
      producedServings: 2,
      assignedServings: 2,
      leftoverServings: 0,
    }

    const html = renderToStaticMarkup(
      <OptimizerSummaryMetrics
        result={result}
        salesPlan={{
          jarTypeSwitches: 0,
          tripCount: 3,
          totalLeftoverServings: 1,
        }}
      />,
    )

    expect(html).toContain('<span>剩餘杯</span><strong>1</strong>')
    expect(html).not.toContain('<span>剩餘杯</span><strong>0</strong>')
  })
})

describe('sales trip interactive checklist UI', () => {
  it('renders selected trips as shared supplied checklists and keeps read-only comparison plans non-interactive', () => {
    const salesDemand: PreparationDemand = {
      ingredients: [],
      productionWaterUnits: 1,
      cleanCupUses: 2,
      producedServings: 2,
      assignedServings: 2,
      leftoverServings: 0,
      recipes: [
        {
          recipeId: 'recipe-a',
          recipeName: 'A',
          customerIds: ['jack', 'leticia'],
          ingredientIds: [],
          productionUnits: 1,
          producedServings: 2,
          assignedServings: 2,
          leftoverServings: 0,
          ingredientUnitsPerJuiceUnit: [],
        },
      ],
    }
    const inventory: InventoryState = {
      ingredientUnits: {},
      intermediateJuiceUnits: {},
      waterUnits: 0,
      cleanCups: 2,
      usedCups: 0,
      juiceJars: [
        { id: 'jar-a', recipeId: null, servings: 0 },
      ],
      shelfCount: 0,
      jarRackCount: 0,
    }
    const shortfall = buildPreparationShortfall(
      salesDemand,
      inventory,
    )
    const plan = buildMultiTripReplenishmentPlan(
      salesDemand,
      'retain-and-wash',
      inventory.juiceJars,
      {
        cleanCups: inventory.cleanCups,
        usedCups: inventory.usedCups,
      },
      shortfall,
      {
        mode: 'fixed-slots',
        reservedSlots: 1,
        minimumCarriedSlots: 0,
      },
      false,
    )

    const interactiveHtml = renderToStaticMarkup(
      <SalesTripPlanBlock
        plan={plan}
        deliveryControls={{
          plan: deliveryPlan(),
          cursor: deliveryCursor(),
          suppliedCustomerIds: ['jack'],
          onChangeCustomer: () => {},
          onChangeGroup: () => {},
        }}
      />,
    )
    const readOnlyHtml = renderToStaticMarkup(
      <SalesTripPlanBlock plan={plan} />,
    )

    expect(interactiveHtml).toContain('第 1 趟全部交付完成')
    expect(interactiveHtml).toContain('aria-checked="mixed"')
    expect(interactiveHtml).toContain('完成 1 / 2')
    expect(interactiveHtml).toContain('東港村')
    expect(interactiveHtml).toContain('出發前')
    expect(interactiveHtml).toContain('販售')
    expect(interactiveHtml).toContain('回工作間')
    expect(interactiveHtml).toContain('容量／路線細節')
    expect(readOnlyHtml).not.toContain('第 1 趟全部交付完成')
    expect(readOnlyHtml).not.toContain('type="checkbox"')
  })
})

describe('remaining sales trip replan UI', () => {
  it('renders only unsupplied customers with their fixed original recipes', () => {
    const remainingPlan = buildRemainingSalesTripPlan({
      recipeAssignments: [
        {
          recipeId: 'recipe-a',
          recipeName: 'A',
          customerIds: ['jack', 'leticia'],
        },
        {
          recipeId: 'recipe-b',
          recipeName: 'B',
          customerIds: ['florida'],
        },
      ],
      suppliedCustomerIds: ['jack'],
      originalTripServingCounts: [2, 1],
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
        ],
      },
      customerRegionById: {
        jack: 'east-harbor',
        leticia: 'east-harbor',
        florida: 'tranquil-fountain',
      },
    })

    const html = renderToStaticMarkup(
      <RemainingSalesTripPlanBlock
        plan={remainingPlan}
        deliveryControls={{
          plan: deliveryPlan(),
          cursor: deliveryCursor(),
          suppliedCustomerIds: ['jack'],
          onChangeCustomer: () => {},
          onChangeGroup: () => {},
        }}
      />,
    )

    expect(html).not.toContain('傑克')
    expect(html).toContain('萊蒂西亞')
    expect(html).toContain('弗洛莉婭')
    expect(html).toContain('A')
    expect(html).toContain('B')
    expect(html).toContain('東港村')
    expect(html).toContain('靜謐噴泉')
    expect(html).toContain('第 1 趟全部交付完成')
    expect(html).not.toContain('果汁罐')
    expect(html).not.toContain('clean cup')
  })
})

describe('sales trip terminal leftover UI', () => {
  it('renders a constrained trip-2 terminal jar as staying home during trip 3', () => {
    const salesDemand: PreparationDemand = {
      ingredients: [],
      productionWaterUnits: 0,
      cleanCupUses: 20,
      producedServings: 22,
      assignedServings: 20,
      leftoverServings: 2,
      recipes: [
        {
          recipeId: 'a',
          recipeName: 'A',
          customerIds: Array.from(
            { length: 10 },
            (_, index) => 'a-customer-' + (index + 1),
          ),
          ingredientIds: [],
          productionUnits: 5,
          producedServings: 10,
          assignedServings: 10,
          leftoverServings: 0,
          ingredientUnitsPerJuiceUnit: [],
        },
        {
          recipeId: 'b',
          recipeName: 'B',
          customerIds: Array.from(
            { length: 3 },
            (_, index) => 'b-customer-' + (index + 1),
          ),
          ingredientIds: [],
          productionUnits: 2,
          producedServings: 4,
          assignedServings: 3,
          leftoverServings: 1,
          ingredientUnitsPerJuiceUnit: [],
        },
        {
          recipeId: 'c',
          recipeName: 'C',
          customerIds: Array.from(
            { length: 7 },
            (_, index) => 'c-customer-' + (index + 1),
          ),
          ingredientIds: [],
          productionUnits: 4,
          producedServings: 8,
          assignedServings: 7,
          leftoverServings: 1,
          ingredientUnitsPerJuiceUnit: [],
        },
      ],
    }
    const inventory: InventoryState = {
      ingredientUnits: {},
      intermediateJuiceUnits: {},
      waterUnits: 0,
      cleanCups: 5,
      usedCups: 5,
      juiceJars: [
        { id: 'jar-1', recipeId: 'a', servings: 1 },
        { id: 'jar-2', recipeId: 'b', servings: 1 },
        { id: 'jar-3', recipeId: 'c', servings: 3 },
      ],
      shelfCount: 0,
      jarRackCount: 1,
    }
    const shortfall = buildPreparationShortfall(
      salesDemand,
      inventory,
    )
    const plan = buildMultiTripReplenishmentPlan(
      salesDemand,
      'retain-and-wash',
      inventory.juiceJars,
      {
        cleanCups: inventory.cleanCups,
        usedCups: inventory.usedCups,
      },
      shortfall,
      {
        mode: 'fixed-slots',
        reservedSlots: 2,
        minimumCarriedSlots: 0,
      },
      false,
    )

    expect(plan.tripCount).toBe(3)
    expect(plan.totalLeftoverServings).toBe(1)
    expect(plan.leftoverJarContents).toEqual([
      {
        physicalJarId: 'jar-1',
        recipeId: 'a',
        recipeName: 'A',
        servings: 1,
        tripNumber: 2,
      },
    ])
    expect(plan.trips[2]?.carriedPhysicalJarIds).not.toContain('jar-1')

    const html = renderToStaticMarkup(
      <SalesTripPlanBlock plan={plan} />,
    )

    expect(html).toContain('期末剩餘')
    expect(html).toContain(
      '期末果汁罐：jar-1 · A · 1 杯 · 第 2 趟後留在家中',
    )
    expect(html).toContain('第 3 趟')
    expect(html).toContain('<strong>jar-2</strong><span>B</span>')
    expect(html).toContain('<strong>jar-3</strong><span>C</span>')
  })
  it('renders Region service roles, transit, physical continuation, and fill timing together', () => {
    const salesDemand: PreparationDemand = {
      ingredients: [],
      productionWaterUnits: 2,
      cleanCupUses: 4,
      producedServings: 4,
      assignedServings: 4,
      leftoverServings: 0,
      recipes: [
        {
          recipeId: 'a',
          recipeName: 'A',
          customerIds: ['east-a', 'ibex-a'],
          ingredientIds: [],
          productionUnits: 1,
          producedServings: 2,
          assignedServings: 2,
          leftoverServings: 0,
          ingredientUnitsPerJuiceUnit: [],
        },
        {
          recipeId: 'b',
          recipeName: 'B',
          customerIds: ['east-b', 'ibex-b'],
          ingredientIds: [],
          productionUnits: 1,
          producedServings: 2,
          assignedServings: 2,
          leftoverServings: 0,
          ingredientUnitsPerJuiceUnit: [],
        },
      ],
    }
    const inventory: InventoryState = {
      ingredientUnits: {},
      intermediateJuiceUnits: {},
      waterUnits: 0,
      cleanCups: 2,
      usedCups: 0,
      juiceJars: [
        { id: 'jar-1', recipeId: null, servings: 0 },
        { id: 'jar-2', recipeId: null, servings: 0 },
      ],
      shelfCount: 0,
      jarRackCount: 1,
    }
    const shortfall = buildPreparationShortfall(
      salesDemand,
      inventory,
    )
    const regionPlan = buildRegionPhysicalSalesPlan({
      demand: salesDemand,
      shortfall,
      policy: 'retain-and-wash',
      availableJuiceJarInventory: inventory.juiceJars,
      cups: {
        cleanCups: inventory.cleanCups,
        usedCups: inventory.usedCups,
      },
      carryPolicy: {
        mode: 'auto',
        reservedSlots: 0,
        minimumCarriedSlots: 0,
      },
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
      customerRegionById: {
        'east-a': 'east-harbor',
        'east-b': 'east-harbor',
        'ibex-a': 'ibex-statue',
        'ibex-b': 'ibex-statue',
      },
    })

    const html = renderToStaticMarkup(
      <SalesTripPlanBlock
        plan={regionPlan.salesPlan}
        regionPlan={regionPlan}
      />,
    )

    expect(html).toContain('工作間')
    expect(html).toContain('羱羊雕像')
    expect(html).toContain('主要 · 東港村')
    expect(html).toContain('主要 · 羱羊雕像')
    expect(html).toContain('途經 · 靜謐噴泉')
    expect(html).toContain('跨區路線邊')
    expect(html).toContain('裝罐')
    expect(html).toContain('沿用罐內成品')
  })
})

describe('optimizer criteria UI', () => {
  it('offers maximum ingredient cost as the same primary/secondary criterion source', () => {
    expect(optimizerCriterionOptions).toContainEqual({
      value: 'maximum-ingredient-cost',
      label: '最高原料成本',
    })
    expect(criterionLabel('maximum-ingredient-cost')).toBe('最高原料成本')
  })
})

describe('planner error UX', () => {
  it('renders a Chinese actionable summary while keeping raw details secondary', () => {
    const presentation = presentPlanningError(
      new PlanningUserError(
        'leftover-storage',
        { remainingServings: 2 },
        'Not enough terminal sales-jar capacity',
      ),
    )
    const html = renderToStaticMarkup(
      <PlanningErrorBlock presentation={presentation} />,
    )

    expect(html).toContain('剩餘果汁沒有足夠的實體罐可保留')
    expect(html).toContain('2 杯')
    expect(html).toContain('增加實體果汁罐')
    expect(html).toContain('技術資訊')
    expect(html).toContain('Not enough terminal sales-jar capacity')
  })
})

describe('plan application preview', () => {
  it('shows terminal jar contents even when the jar has no net before/after change', () => {
    const base = transactionDraft()
    const draft: PlanApplicationTransactionDraft = {
      ...base,
      before: {
        ...base.before,
        inventory: {
          ...base.before.inventory,
          juiceJars: [
            {
              id: 'jar-1',
              recipeId: 'lemon-juice',
              servings: 1,
            },
          ],
        },
      },
      after: {
        ...base.after,
        inventory: {
          ...base.after.inventory,
          juiceJars: [
            {
              id: 'jar-1',
              recipeId: 'lemon-juice',
              servings: 1,
            },
          ],
        },
      },
      changes: {
        ...base.changes,
        juiceJars: [],
        discardedJuice: [],
      },
    }
    const terminalFills: MultiTripProductionJarFill[] = [
      {
        physicalJarId: 'jar-1',
        recipeId: 'lemon-juice',
        recipeName: '檸檬汁',
        beforeTripNumber: 2,
        servings: 2,
        servingsAfterFill: 2,
        fillAction: 'refill-same-type',
        previousRecipeId: 'lemon-juice',
        previousRecipeName: '檸檬汁',
        receiver: 'carried-jar',
      },
    ]

    const html = renderToStaticMarkup(
      <PlanApplicationPreview
        draft={draft}
        productionJarFills={terminalFills}
        onApply={() => {}}
      />,
    )

    expect(html).toContain('期末沒有果汁罐內容淨變更')
    expect(html).toContain('期末果汁罐內容')
    expect(html).toContain('果汁罐 jar-1')
    expect(html).toContain('檸檬汁 · 1 杯')
  })

  it('renders before/after state and the Phase 5C-4 apply control', () => {
    const html = renderToStaticMarkup(
      <PlanApplicationPreview
        draft={transactionDraft()}
        productionJarFills={fills}
        onApply={() => {}}
      />,
    )

    expect(html).toContain('套用規劃預覽')
    expect(html).toContain('確認後才會寫入')
    expect(html).toContain('確認套用這份規劃')
    expect(html).toContain('檸檬')
    expect(html).toContain('庫存水量')
    expect(html).toContain('乾淨杯')
    expect(html).toContain('用過的杯子')
    expect(html).toContain('果汁罐 jar-1')
    expect(html).toContain('檸檬汁')
    expect(html).toContain('橙汁')
    expect(html).toContain('換裝')
    expect(html).toContain('將倒掉的果汁')
    expect(html).toContain('既有內容')
    expect(html).toContain('本次新製作殘餘')
    expect(html).toContain('第 2 趟後')
    expect(html).toContain('倒掉 1 杯')
    expect(html).toContain('第 2 趟販售前')
    expect(html).toContain('傑克')
    expect(html).toContain('帽匠')
    expect(html).toContain('任一項改變')
  })
})


describe('recipe allocation preparation source summary', () => {
  it('shows existing finished jar stock without claiming new production', () => {
    const shortfall = buildPreparationShortfall(
      {
        ingredients: [
          { ingredientId: 'lemon', name: '檸檬', quantity: 1 },
          { ingredientId: 'mint', name: '薄荷', quantity: 1 },
          { ingredientId: 'sugar', name: '糖', quantity: 1 },
        ],
        productionWaterUnits: 1,
        cleanCupUses: 1,
        producedServings: 2,
        assignedServings: 1,
        leftoverServings: 1,
        recipes: [
          {
            recipeId: 'sweet',
            recipeName: '甜味',
            customerIds: ['betsy'],
            ingredientIds: ['lemon', 'mint', 'sugar'],
            productionUnits: 1,
            producedServings: 2,
            assignedServings: 1,
            leftoverServings: 1,
            ingredientUnitsPerJuiceUnit: [
              { ingredientId: 'lemon', quantityPerJuiceUnit: 1 },
              { ingredientId: 'mint', quantityPerJuiceUnit: 1 },
              { ingredientId: 'sugar', quantityPerJuiceUnit: 1 },
            ],
          },
        ],
      },
      {
        ingredientUnits: {},
        intermediateJuiceUnits: {},
        waterUnits: 0,
        cleanCups: 1,
        usedCups: 0,
        juiceJars: [
          {
            id: 'jar-1',
            recipeId: 'sweet',
            servings: 1,
          },
        ],
        shelfCount: 0,
        jarRackCount: 0,
      },
    )

    expect(
      recipePreparationSourceSummary(
        {
          recipeId: 'sweet',
          assignedServings: 1,
          juiceUnits: 1,
          producedServings: 2,
          leftoverServings: 1,
        },
        shortfall,
      ),
    ).toBe(
      '需求 1 杯 · 使用既有成品 1 杯（jar-1 1 杯） · 不需新增製作',
    )
  })

  it('separates existing finished stock from new production', () => {
    const shortfall = buildPreparationShortfall(
      {
        ingredients: [
          { ingredientId: 'lemon', name: '檸檬', quantity: 2 },
          { ingredientId: 'sugar', name: '糖', quantity: 2 },
        ],
        productionWaterUnits: 2,
        cleanCupUses: 3,
        producedServings: 4,
        assignedServings: 3,
        leftoverServings: 1,
        recipes: [
          {
            recipeId: 'lemon-sugar',
            recipeName: '檸檬糖',
            customerIds: ['a', 'b', 'c'],
            ingredientIds: ['lemon', 'sugar'],
            productionUnits: 2,
            producedServings: 4,
            assignedServings: 3,
            leftoverServings: 1,
            ingredientUnitsPerJuiceUnit: [
              { ingredientId: 'lemon', quantityPerJuiceUnit: 1 },
              { ingredientId: 'sugar', quantityPerJuiceUnit: 1 },
            ],
          },
        ],
      },
      {
        ingredientUnits: {},
        intermediateJuiceUnits: {},
        waterUnits: 0,
        cleanCups: 3,
        usedCups: 0,
        juiceJars: [
          {
            id: 'jar-1',
            recipeId: 'lemon-sugar',
            servings: 1,
          },
        ],
        shelfCount: 0,
        jarRackCount: 0,
      },
    )

    expect(
      recipePreparationSourceSummary(
        {
          recipeId: 'lemon-sugar',
          assignedServings: 3,
          juiceUnits: 2,
          producedServings: 4,
          leftoverServings: 1,
        },
        shortfall,
      ),
    ).toBe(
      '需求 3 杯 · 使用既有成品 1 杯（jar-1 1 杯） · 新製作果汁 1 份 → 2 杯',
    )
  })
})
