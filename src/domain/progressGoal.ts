import { progressMilestones } from '../data/progress'
import { villages } from '../data/villages'
import type {
  ProgressMilestoneDefinition,
  ProgressMilestoneId,
  SatisfactionByVillage,
  VillageDefinition,
  VillageId,
} from '../types'

export type ProgressGoalThreshold = {
  kind: 'satisfaction' | 'formal-customers'
  villageId: VillageId
  current: number
  required: number
  remaining: number
}

export interface ProgressGoal {
  milestone: ProgressMilestoneDefinition
  region: VillageDefinition | null
  thresholds: ProgressGoalThreshold[]
}

type CustomerVillageRef = {
  id: string
  villageId: VillageId
}

function currentFormalCustomerCounts(
  customerDefinitions: readonly CustomerVillageRef[],
  formalCustomerIds: readonly string[],
): Record<VillageId, number> {
  const formalIds = new Set(formalCustomerIds)
  return Object.fromEntries(
    villages.map((village) => [
      village.id,
      customerDefinitions.filter(
        (customer) =>
          customer.villageId === village.id && formalIds.has(customer.id),
      ).length,
    ]),
  ) as Record<VillageId, number>
}

function threshold(
  kind: ProgressGoalThreshold['kind'],
  villageId: VillageId,
  current: number,
  required: number,
): ProgressGoalThreshold {
  return {
    kind,
    villageId,
    current,
    required,
    remaining: Math.max(0, required - current),
  }
}

export function nextProgressGoal({
  currentProgress,
  satisfactionByVillage,
  customerDefinitions,
  formalCustomerIds,
  milestoneDefinitions = progressMilestones,
  villageDefinitions = villages,
}: {
  currentProgress: ProgressMilestoneId
  satisfactionByVillage: SatisfactionByVillage
  customerDefinitions: readonly CustomerVillageRef[]
  formalCustomerIds: readonly string[]
  milestoneDefinitions?: readonly ProgressMilestoneDefinition[]
  villageDefinitions?: readonly VillageDefinition[]
}): ProgressGoal | null {
  const currentIndex = milestoneDefinitions.findIndex(
    (milestone) => milestone.id === currentProgress,
  )
  if (currentIndex < 0) return null

  const milestone = milestoneDefinitions[currentIndex + 1]
  if (!milestone) return null

  const formalCounts = currentFormalCustomerCounts(
    customerDefinitions,
    formalCustomerIds,
  )
  const thresholds: ProgressGoalThreshold[] = []

  for (const village of villageDefinitions) {
    const required =
      milestone.requirement?.satisfactionByVillageRequired?.[village.id]
    if (required !== undefined) {
      thresholds.push(
        threshold(
          'satisfaction',
          village.id,
          satisfactionByVillage[village.id] ?? 0,
          required,
        ),
      )
    }
  }

  for (const village of villageDefinitions) {
    const required =
      milestone.requirement?.formalCustomersByVillageRequired?.[village.id]
    if (required !== undefined) {
      thresholds.push(
        threshold(
          'formal-customers',
          village.id,
          formalCounts[village.id] ?? 0,
          required,
        ),
      )
    }
  }

  return {
    milestone,
    region:
      villageDefinitions.find(
        (village) => village.unlockedAt === milestone.id,
      ) ?? null,
    thresholds,
  }
}

export function nextFormalCustomerRequirementForVillage(
  currentProgress: ProgressMilestoneId,
  villageId: VillageId,
  milestoneDefinitions: readonly ProgressMilestoneDefinition[] = progressMilestones,
): { milestone: ProgressMilestoneDefinition; required: number } | null {
  const currentIndex = milestoneDefinitions.findIndex(
    (milestone) => milestone.id === currentProgress,
  )
  if (currentIndex < 0) return null

  for (const milestone of milestoneDefinitions.slice(currentIndex + 1)) {
    const required =
      milestone.requirement?.formalCustomersByVillageRequired?.[villageId]
    if (required !== undefined) {
      return { milestone, required }
    }
  }

  return null
}
