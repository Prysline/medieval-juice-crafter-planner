import { describe, expect, it } from 'vitest'
import type {
  PlanApplicationBasisState,
  PlanApplicationTransactionDraft,
} from './planApplicationTransaction'
import { validatePlanApplicationTransactionBasis } from './planApplicationValidation'

function basis(): PlanApplicationBasisState {
  return {
    inventory: {
      ingredientUnits: {
        lemon: 3,
        sugar: 2,
      },
      waterUnits: 4,
      cleanCups: 2,
      usedCups: 1,
      juiceJars: [
        {
          id: 'jar-a',
          recipeId: 'lemon-juice',
          servings: 2,
        },
        {
          id: 'jar-b',
          recipeId: null,
          servings: 0,
        },
      ],
      shelfCount: 1,
      jarRackCount: 1,
    },
    currentProgress: 'opening',
    satisfactionByVillage: {
      'east-harbor': 10,
      'tranquil-fountain': 20,
    },
    formalCustomerIds: ['jack', 'nanette'],
    suppliedCustomerIds: ['ulrich', 'alia'],
    plannerSettings: {
      juiceJarCarryMode: 'fixed-slots',
      reservedJuiceJarSlots: 2,
      allowUsedCupDropIfFull: false,
      allowDiscardRetainedJuice: false,
    },
  }
}

function draftFromBasis(
  source: PlanApplicationBasisState,
): PlanApplicationTransactionDraft {
  return {
    schemaVersion: 'plan-application-v1',
    before: {
      inventory: {
        ingredientUnits: { ...source.inventory.ingredientUnits },
        waterUnits: source.inventory.waterUnits,
        cleanCups: source.inventory.cleanCups,
        usedCups: source.inventory.usedCups,
        juiceJars: source.inventory.juiceJars.map((jar) => ({
          ...jar,
        })),
        shelfCount: source.inventory.shelfCount,
        jarRackCount: source.inventory.jarRackCount,
      },
      currentProgress: source.currentProgress,
      satisfactionByVillage: {
        ...source.satisfactionByVillage,
      },
      formalCustomerIds: [...source.formalCustomerIds],
      suppliedCustomerIds: [...source.suppliedCustomerIds],
      plannerSettings: {
        juiceJarCarryMode: source.plannerSettings.juiceJarCarryMode,
        reservedJuiceJarSlots:
          source.plannerSettings.reservedJuiceJarSlots,
        allowUsedCupDropIfFull:
          source.plannerSettings.allowUsedCupDropIfFull,
        allowDiscardRetainedJuice:
          source.plannerSettings.allowDiscardRetainedJuice,
      },
    },
    after: {
      inventory: {
        ingredientUnits: { ...source.inventory.ingredientUnits },
        waterUnits: source.inventory.waterUnits,
        cleanCups: source.inventory.cleanCups,
        usedCups: source.inventory.usedCups,
        juiceJars: source.inventory.juiceJars.map((jar) => ({
          ...jar,
        })),
        shelfCount: source.inventory.shelfCount,
        jarRackCount: source.inventory.jarRackCount,
      },
      currentProgress: source.currentProgress,
      satisfactionByVillage: {
        ...source.satisfactionByVillage,
      },
      formalCustomerIds: [...source.formalCustomerIds],
      suppliedCustomerIds: [...source.suppliedCustomerIds],
      plannerSettings: {
        juiceJarCarryMode: source.plannerSettings.juiceJarCarryMode,
        reservedJuiceJarSlots:
          source.plannerSettings.reservedJuiceJarSlots,
        allowUsedCupDropIfFull:
          source.plannerSettings.allowUsedCupDropIfFull,
        allowDiscardRetainedJuice:
          source.plannerSettings.allowDiscardRetainedJuice,
      },
    },
    changes: {
      ingredients: [],
      water: {
        beforeUnits: source.inventory.waterUnits,
        afterUnits: source.inventory.waterUnits,
        consumedFromInventory: 0,
        productionUnitsRequired: 0,
        cupWashUnitsRequired: 0,
        externalUnitsRequired: 0,
      },
      cups: {
        cleanBefore: source.inventory.cleanCups,
        cleanAfter: source.inventory.cleanCups,
        usedBefore: source.inventory.usedCups,
        usedAfter: source.inventory.usedCups,
        physicalBefore:
          source.inventory.cleanCups + source.inventory.usedCups,
        physicalAfter:
          source.inventory.cleanCups + source.inventory.usedCups,
        droppedUsedCups: 0,
      },
      juiceJars: [],
      discardedJuice: [],
      newlySuppliedCustomerIds: [],
    },
  }
}

describe('plan application transaction basis validation', () => {
  it('accepts semantically identical customer sets and ingredient records', () => {
    const current = basis()
    const draft = draftFromBasis(current)
    const reordered: PlanApplicationBasisState = {
      ...current,
      inventory: {
        ...current.inventory,
        ingredientUnits: {
          sugar: 2,
          lemon: 3,
        },
      },
      formalCustomerIds: ['nanette', 'jack', 'jack'],
      suppliedCustomerIds: ['alia', 'ulrich'],
    }

    expect(
      validatePlanApplicationTransactionBasis(
        draft,
        reordered,
      ),
    ).toEqual({
      valid: true,
      stale: false,
      mismatches: [],
    })
  })

  it('reports deterministic mismatch fields for every changed dependency', () => {
    const original = basis()
    const changed = basis()
    changed.inventory.waterUnits = 5
    changed.currentProgress = 'seasoner-unlocked'
    changed.satisfactionByVillage['east-harbor'] = 11
    changed.formalCustomerIds = ['jack']
    changed.suppliedCustomerIds = ['ulrich']
    changed.plannerSettings.allowUsedCupDropIfFull = true

    expect(
      validatePlanApplicationTransactionBasis(
        draftFromBasis(original),
        changed,
      ),
    ).toEqual({
      valid: false,
      stale: true,
      mismatches: [
        'inventory',
        'current-progress',
        'satisfaction',
        'formal-customers',
        'supplied-customers',
        'planner-settings',
      ],
    })
  })

  it('treats physical jar order and slot carry policy as planning dependencies', () => {
    const original = basis()
    const changed = basis()
    changed.inventory.juiceJars.reverse()
    changed.plannerSettings.reservedJuiceJarSlots = 1

    expect(
      validatePlanApplicationTransactionBasis(
        draftFromBasis(original),
        changed,
      ).mismatches,
    ).toEqual(['inventory', 'planner-settings'])
  })
})
