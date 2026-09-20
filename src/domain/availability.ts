import { progressMilestoneIndex } from '../data/progress'
import { villages } from '../data/villages'
import type {
  Customer,
  Equipment,
  Ingredient,
  ProgressMilestoneId,
  Recipe,
  SatisfactionByVillage,
  ShopDefinition,
  VillageId,
} from '../types'

export function isAvailableAtProgress(
  unlockedAt: ProgressMilestoneId,
  currentProgress: ProgressMilestoneId,
): boolean {
  return (
    (progressMilestoneIndex.get(unlockedAt) ?? Number.POSITIVE_INFINITY) <=
    (progressMilestoneIndex.get(currentProgress) ?? Number.NEGATIVE_INFINITY)
  )
}

export function ingredientIsAvailable(
  ingredient: Ingredient,
  currentProgress: ProgressMilestoneId,
): boolean {
  return isAvailableAtProgress(ingredient.unlockedAt, currentProgress)
}

export function recipeIsAvailable(
  recipe: Recipe,
  currentProgress: ProgressMilestoneId,
): boolean {
  return isAvailableAtProgress(recipe.unlockedAt, currentProgress)
}

export function equipmentIsAvailable(
  equipment: Equipment,
  currentProgress: ProgressMilestoneId,
): boolean {
  return isAvailableAtProgress(equipment.unlockedAt, currentProgress)
}

export function shopIsAvailable(
  shop: ShopDefinition,
  currentProgress: ProgressMilestoneId,
): boolean {
  return (
    villageIsAvailable(shop.villageId, currentProgress) &&
    isAvailableAtProgress(shop.unlockedAt, currentProgress)
  )
}

export function villageIsAvailable(
  villageId: VillageId,
  currentProgress: ProgressMilestoneId,
): boolean {
  const village = villages.find((item) => item.id === villageId)
  return village
    ? isAvailableAtProgress(village.unlockedAt, currentProgress)
    : false
}

export function customerVillageIsAvailable(
  customer: Customer,
  currentProgress: ProgressMilestoneId,
): boolean {
  return villageIsAvailable(customer.villageId, currentProgress)
}

export function customerMeetsSatisfactionRequirement(
  customer: Customer,
  satisfactionByVillage: SatisfactionByVillage,
): boolean {
  return (
    (satisfactionByVillage[customer.villageId] ?? 0) >=
    customer.satisfactionRequired
  )
}

export function customerIsUnlocked(
  customer: Customer,
  currentProgress: ProgressMilestoneId,
  satisfactionByVillage: SatisfactionByVillage,
): boolean {
  return (
    customerVillageIsAvailable(customer, currentProgress) &&
    customerMeetsSatisfactionRequirement(customer, satisfactionByVillage)
  )
}

export function visibleCustomers(
  customers: Customer[],
  currentProgress: ProgressMilestoneId,
  satisfactionByVillage: SatisfactionByVillage,
  includeSatisfactionLocked: boolean,
): Customer[] {
  return customers
    .filter((customer) => customerVillageIsAvailable(customer, currentProgress))
    .filter(
      (customer) =>
        includeSatisfactionLocked ||
        customerMeetsSatisfactionRequirement(customer, satisfactionByVillage),
    )
}
