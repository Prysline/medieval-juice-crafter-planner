import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MultiTripProductionJarFill } from './domain/multiTripReplenishment'
import type { PlanApplicationTransactionDraft } from './domain/planApplicationTransaction'
import {
  INVENTORY_RECIPE_SEARCH_RESULT_LIMIT,
  JuiceJarRecipeCombobox,
  MachineBatchFlow,
  PlanApplicationPreview,
  PlanningErrorBlock,
  criterionLabel,
  moveInventoryRecipeSearchIndex,
  optimizerCriterionOptions,
  optimizerInventoryIngredients,
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
  const pool = buildRecipeCandidatePool('juice-blender-unlocked')
  const entries = recipeCandidateEntriesForInventoryEditor(pool)

  it('searches observed, saved-safe scope and safe computed recipes while bounding rendered results', () => {
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

  it('wraps keyboard navigation across the bounded result list', () => {
    expect(moveInventoryRecipeSearchIndex(0, 'next', 3)).toBe(1)
    expect(moveInventoryRecipeSearchIndex(2, 'next', 3)).toBe(0)
    expect(moveInventoryRecipeSearchIndex(0, 'previous', 3)).toBe(2)
    expect(moveInventoryRecipeSearchIndex(1, 'previous', 3)).toBe(0)
    expect(moveInventoryRecipeSearchIndex(4, 'next', 0)).toBe(0)
  })

  it('keeps unknown legacy jar content readable and exposes an explicit clear action', () => {
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
