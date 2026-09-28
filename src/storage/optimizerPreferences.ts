import { customers } from '../data/customers'
import { villages } from '../data/villages'
import type {
  OptimizationCandidatePolicy,
  OptimizationCriterion,
  OptimizationMaterialSourceMode,
} from '../domain/optimizer'
import type {
  OptimizerCustomerScope,
  OptimizerCustomerTarget,
} from '../domain/optimizerUi'
import type { VillageId } from '../types'
import type { StorageLike } from './plannerState'

export const OPTIMIZER_PREFERENCES_STORAGE_KEY =
  'mjc-optimizer-preferences'

export type OptimizerOptionalCriterion =
  | OptimizationCriterion
  | 'none'

export interface OptimizerPreferences {
  schemaVersion: 1
  scope: OptimizerCustomerScope
  targetMode: OptimizerCustomerTarget['mode']
  selectedVillageIds: VillageId[]
  selectedCustomerIds: string[]
  candidatePolicy: OptimizationCandidatePolicy
  materialSourceMode: OptimizationMaterialSourceMode
  primaryCriterion: OptimizationCriterion
  secondaryOne: OptimizerOptionalCriterion
  secondaryTwo: OptimizerOptionalCriterion
  maxJarFillOperations: number | null
  activeWorkshopRegionId: VillageId
}

export const DEFAULT_OPTIMIZER_PREFERENCES: OptimizerPreferences = {
  schemaVersion: 1,
  scope: 'all',
  targetMode: 'all',
  selectedVillageIds: [],
  selectedCustomerIds: [],
  candidatePolicy: 'trusted-only',
  materialSourceMode: 'normal',
  primaryCriterion: 'minimum-cost',
  secondaryOne: 'none',
  secondaryTwo: 'none',
  maxJarFillOperations: null,
  activeWorkshopRegionId: 'east-harbor',
}

const scopes = new Set<OptimizerCustomerScope>([
  'all',
  'potential',
  'formal',
])

const targetModes = new Set<OptimizerCustomerTarget['mode']>([
  'all',
  'villages',
  'customers',
])

const candidatePolicies = new Set<OptimizationCandidatePolicy>([
  'trusted-only',
  'allow-unambiguous-computed',
])

const materialSourceModes =
  new Set<OptimizationMaterialSourceMode>([
    'normal',
    'inventory-only',
  ])

const criteria = new Set<OptimizationCriterion>([
  'minimum-machine-operations',
  'minimum-jar-fill-operations',
  'minimum-cost',
  'minimum-waste',
  'maximum-ingredient-cost',
  'maximum-known-revenue',
  'maximum-known-gross-profit',
])

const canonicalVillageIds = new Set<VillageId>(
  villages.map((village) => village.id),
)
const canonicalCustomerIds = new Set(
  customers.map((customer) => customer.id),
)

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  fallback: T,
): T {
  return typeof value === 'string' && allowed.has(value as T)
    ? value as T
    : fallback
}

function normalizeIds<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
): T[] {
  if (!Array.isArray(value)) return []

  const result: T[] = []
  const seen = new Set<T>()
  for (const item of value) {
    if (
      typeof item !== 'string' ||
      !allowed.has(item as T) ||
      seen.has(item as T)
    ) {
      continue
    }
    seen.add(item as T)
    result.push(item as T)
  }
  return result
}

function normalizeOptionalCriterion(
  value: unknown,
): OptimizerOptionalCriterion {
  if (value === 'none') return 'none'
  return typeof value === 'string' &&
    criteria.has(value as OptimizationCriterion)
    ? value as OptimizationCriterion
    : 'none'
}

function normalizeMaxJarFillOperations(
  value: unknown,
): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return null
  }
  return Math.floor(value)
}

export function normalizeOptimizerPreferences(
  value: unknown,
): OptimizerPreferences {
  const source = asRecord(value)
  const primaryCriterion = normalizeEnum(
    source.primaryCriterion,
    criteria,
    DEFAULT_OPTIMIZER_PREFERENCES.primaryCriterion,
  )

  let secondaryOne = normalizeOptionalCriterion(
    source.secondaryOne,
  )
  if (secondaryOne === primaryCriterion) {
    secondaryOne = 'none'
  }

  let secondaryTwo = normalizeOptionalCriterion(
    source.secondaryTwo,
  )
  if (
    secondaryTwo === primaryCriterion ||
    (
      secondaryOne !== 'none' &&
      secondaryTwo === secondaryOne
    )
  ) {
    secondaryTwo = 'none'
  }

  return {
    schemaVersion: 1,
    scope: normalizeEnum(
      source.scope,
      scopes,
      DEFAULT_OPTIMIZER_PREFERENCES.scope,
    ),
    targetMode: normalizeEnum(
      source.targetMode,
      targetModes,
      DEFAULT_OPTIMIZER_PREFERENCES.targetMode,
    ),
    selectedVillageIds: normalizeIds(
      source.selectedVillageIds,
      canonicalVillageIds,
    ),
    selectedCustomerIds: normalizeIds(
      source.selectedCustomerIds,
      canonicalCustomerIds,
    ),
    candidatePolicy: normalizeEnum(
      source.candidatePolicy,
      candidatePolicies,
      DEFAULT_OPTIMIZER_PREFERENCES.candidatePolicy,
    ),
    materialSourceMode: normalizeEnum(
      source.materialSourceMode,
      materialSourceModes,
      DEFAULT_OPTIMIZER_PREFERENCES.materialSourceMode,
    ),
    primaryCriterion,
    secondaryOne,
    secondaryTwo,
    maxJarFillOperations: normalizeMaxJarFillOperations(
      source.maxJarFillOperations,
    ),
    activeWorkshopRegionId: normalizeEnum(
      source.activeWorkshopRegionId,
      canonicalVillageIds,
      DEFAULT_OPTIMIZER_PREFERENCES.activeWorkshopRegionId,
    ),
  }
}

export function readOptimizerPreferences(
  storage: StorageLike,
): OptimizerPreferences {
  const raw = storage.getItem(OPTIMIZER_PREFERENCES_STORAGE_KEY)
  if (raw === null) {
    return { ...DEFAULT_OPTIMIZER_PREFERENCES }
  }

  try {
    return normalizeOptimizerPreferences(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_OPTIMIZER_PREFERENCES }
  }
}

export function writeOptimizerPreferences(
  storage: StorageLike,
  preferences: OptimizerPreferences,
): void {
  storage.setItem(
    OPTIMIZER_PREFERENCES_STORAGE_KEY,
    JSON.stringify(normalizeOptimizerPreferences(preferences)),
  )
}
