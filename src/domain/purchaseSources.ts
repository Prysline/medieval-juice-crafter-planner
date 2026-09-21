import { isAvailableAtProgress } from './availability'
import { ingredients } from '../data/ingredients'
import { shops } from '../data/shops'
import type { ProgressMilestoneId, VillageId } from '../types'
import type { PreparationShortfall } from './preparationShortfall'

export interface PurchaseSourceOption {
  sourceId: string
  sourceKind: 'canonical-seller' | 'shop'
  sellerName: string
  villageId: VillageId | null
  unitPrice: number
}

export type PurchaseSourceDecisionStatus =
  | 'unique-cheapest'
  | 'price-tie'
  | 'no-known-source'

export interface IngredientPurchaseDecision {
  ingredientId: string
  name: string
  quantity: number
  sourceOptions: PurchaseSourceOption[]
  cheapestUnitPrice: number | null
  cheapestSourceIds: string[]
  selectedSourceId: string | null
  status: PurchaseSourceDecisionStatus
  minimumEstimatedCost: number | null
}

function availableSourcesForIngredient(
  ingredientId: string,
  currentProgress: ProgressMilestoneId,
): PurchaseSourceOption[] {
  const ingredient = ingredients.find((item) => item.id === ingredientId)
  const sources: PurchaseSourceOption[] = []

  if (
    ingredient &&
    isAvailableAtProgress(ingredient.unlockedAt, currentProgress)
  ) {
    sources.push({
      sourceId: `canonical:${ingredient.id}`,
      sourceKind: 'canonical-seller',
      sellerName: ingredient.seller,
      villageId: null,
      unitPrice: ingredient.buyPrice,
    })
  }

  for (const shop of shops) {
    if (!isAvailableAtProgress(shop.unlockedAt, currentProgress)) {
      continue
    }

    for (const entry of shop.inventory) {
      if (entry.ingredientId !== ingredientId) continue

      sources.push({
        sourceId: `shop:${shop.id}`,
        sourceKind: 'shop',
        sellerName: shop.name,
        villageId: shop.villageId,
        unitPrice: entry.buyPrice,
      })
    }
  }

  return sources.sort(
    (a, b) =>
      a.unitPrice - b.unitPrice ||
      a.sellerName.localeCompare(b.sellerName, 'zh-Hant') ||
      a.sourceId.localeCompare(b.sourceId),
  )
}

export function buildPurchaseDecisions(
  shortfall: PreparationShortfall,
  currentProgress: ProgressMilestoneId,
): IngredientPurchaseDecision[] {
  return shortfall.ingredients
    .filter((item) => item.purchaseUnits > 0)
    .map((item): IngredientPurchaseDecision => {
      const sourceOptions = availableSourcesForIngredient(
        item.ingredientId,
        currentProgress,
      )

      if (sourceOptions.length === 0) {
        return {
          ingredientId: item.ingredientId,
          name: item.name,
          quantity: item.purchaseUnits,
          sourceOptions: [],
          cheapestUnitPrice: null,
          cheapestSourceIds: [],
          selectedSourceId: null,
          status: 'no-known-source',
          minimumEstimatedCost: null,
        }
      }

      const cheapestUnitPrice = sourceOptions[0].unitPrice
      const cheapestSourceIds = sourceOptions
        .filter((source) => source.unitPrice === cheapestUnitPrice)
        .map((source) => source.sourceId)
      const status: PurchaseSourceDecisionStatus =
        cheapestSourceIds.length === 1
          ? 'unique-cheapest'
          : 'price-tie'

      return {
        ingredientId: item.ingredientId,
        name: item.name,
        quantity: item.purchaseUnits,
        sourceOptions,
        cheapestUnitPrice,
        cheapestSourceIds,
        selectedSourceId:
          status === 'unique-cheapest'
            ? cheapestSourceIds[0]
            : null,
        status,
        minimumEstimatedCost:
          cheapestUnitPrice * item.purchaseUnits,
      }
    })
}
