import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { customers } from './data/customers'
import { villageNames } from './data/villages'
import { ingredients } from './data/ingredients'
import { recipes } from './data/recipes'
import { recipeIngredientCapabilities } from './data/recipeIngredientCapabilities'
import { ingredientIsAvailable } from './domain/availability'
import {
  availableProductionWorkshopRegions,
  productionCustomerRegionById,
  productionRegionRoutingInput,
} from './domain/regionProductionAdapter'
import type { RegionPhysicalSalesPlan } from './domain/regionPhysicalSalesPlanner'
import {
  buildRemainingSalesTripPlan,
  type RemainingSalesTripPlan,
} from './domain/remainingSalesTripPlanner'
import {
  optimizerCustomerIds,
  optimizerCustomerLabel,
  optimizerMoney,
  optimizerOperationQuantities,
  optimizerWaterFetchSlots,
  type OptimizerCustomerScope,
  type OptimizerCustomerTarget,
} from './domain/optimizerUi'
import type {
  OptimizationCandidatePolicy,
  OptimizationCriterion,
  OptimizationResult,
  RecipeProductionPlan,
} from './domain/optimizer'
import {
  isOptimizerWorkerCancelledError,
  runOptimizerInWorker,
} from './domain/optimizerWorkerClient'
import {
  formatRecipeDisplayName,
  formatRecipeSequence,
} from './domain/displayFormat'
import type {
  MultiTripJuiceJarLoad,
  MultiTripProductionJarFill,
  MultiTripReplenishmentPlan,
  UsedCupTripPolicy,
} from './domain/multiTripReplenishment'
import type { PreparationShortfall } from './domain/preparationShortfall'
import {
  buildDeliveryExecutionPlan,
  createDeliveryExecutionCursor,
  type DeliveryExecutionCursor,
  type DeliveryExecutionPlan,
} from './domain/deliveryExecution'
import {
  recipeCandidateEntriesForInventoryEditor,
  type RecipeCandidatePool,
  type RecipeCandidatePoolEntry,
} from './domain/recipeCandidatePool'
import type { ProductionLogisticsPlan } from './domain/productionLogistics'
import { productionPathForIngredientIds } from './domain/productionPlan'
import { juiceStateIdentity } from './domain/juiceStateIdentity'
import {
  rebasePlanApplicationTransactionSuppliedCustomers,
  type PlanApplicationTransactionDraft,
} from './domain/planApplicationTransaction'
import type { PlanApplicationBasisMismatchField } from './domain/planApplicationValidation'
import {
  buildInventoryCapacitySummary,
  selectAccessibleJuiceJars,
} from './domain/inventoryCapacity'
import {
  readInventoryState,
  resizeJuiceJarInventory,
  writeInventoryState,
} from './storage/inventoryState'
import {
  readPlannerSettings,
  writePlannerSettings,
} from './storage/plannerSettings'
import {
  productionOperationId,
  productionPlanFingerprint,
  readProductionChecklist,
  writeProductionChecklist,
} from './storage/productionChecklist'
import { commitPlanApplicationTransaction } from './storage/planApplicationCommit'
import {
  ingredientChecklistFingerprint,
  readIngredientChecklist,
  writeIngredientChecklist,
} from './storage/ingredientChecklist'
import {
  deliveryExecutionCanonicalBasisFingerprint,
  type DeliveryExecutionCommitStaleField,
} from './storage/deliveryExecutionCommit'
import { writeSuppliedCustomerIds } from './storage/plannerState'
import {
  PlanningUserError,
  presentPlanningError,
  type PlanningErrorPresentation,
} from './domain/planningErrors'
import type {
  InventoryState,
  PlannerSettings,
  ProgressMilestoneId,
  RecipeCandidate,
  SatisfactionByVillage,
  VillageId,
} from './types'

interface OptimizerToolsProps {
  currentProgress: ProgressMilestoneId
  satisfactionByVillage: SatisfactionByVillage
  suppliedCustomerIds: string[]
  formalCustomerIds: string[]
  recipeCandidatePool: RecipeCandidatePool
  onSuppliedCustomerIdsCommitted: (customerIds: string[]) => void
}

interface SalesTripPlans {
  selected: MultiTripReplenishmentPlan
  selectedRegion: RegionPhysicalSalesPlan
  alternate: MultiTripReplenishmentPlan | null
  alternateRegion: RegionPhysicalSalesPlan | null
  alternatePolicy: UsedCupTripPolicy
  alternateError: string | null
}

interface DeliveryExecutionBasis {
  inventory: InventoryState
  suppliedCustomerIds: string[]
}

type OptimizerRunState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'success'
      result: OptimizationResult
      preparationShortfall: PreparationShortfall
      productionLogistics: ProductionLogisticsPlan
      salesTripPlans: SalesTripPlans
      transactionDraft: PlanApplicationTransactionDraft | null
      transactionDraftInvalidatedByPartialDelivery: boolean
      deliveryExecutionPlan: DeliveryExecutionPlan | null
      deliveryCursor: DeliveryExecutionCursor | null
      deliveryExpectedBasis: DeliveryExecutionBasis
    }
  | { status: 'error'; error: PlanningErrorPresentation }

type PlanApplicationUiState =
  | { status: 'idle' }
  | { status: 'applied' }
  | {
      status: 'stale'
      mismatches: readonly PlanApplicationBasisMismatchField[]
    }
  | { status: 'error'; error: PlanningErrorPresentation }

type DeliveryUiState =
  | { status: 'idle' }
  | { status: 'applied'; customerIds: readonly string[] }
  | {
      status: 'stale'
      mismatches: readonly DeliveryExecutionCommitStaleField[]
    }
  | { status: 'error'; message: string }

interface DeliveryCanonicalSyncGuard {
  allowedFingerprints: readonly string[]
  targetFingerprint: string
}

export function deliveryCanonicalSyncStatus(
  guard: DeliveryCanonicalSyncGuard,
  currentFingerprint: string,
): 'pending' | 'complete' | 'unexpected' {
  if (currentFingerprint === guard.targetFingerprint) {
    return 'complete'
  }
  return guard.allowedFingerprints.includes(currentFingerprint)
    ? 'pending'
    : 'unexpected'
}

type OptionalCriterion = OptimizationCriterion | 'none'

const planApplicationMismatchLabels: Record<
  PlanApplicationBasisMismatchField,
  string
> = {
  inventory: '庫存',
  'current-progress': '主線進度',
  satisfaction: '村莊滿意度',
  'formal-customers': '正式顧客',
  'supplied-customers': '今日已供應',
  'planner-settings': '規劃器設定',
}

const deliveryMismatchLabels: Record<
  DeliveryExecutionCommitStaleField,
  string
> = {
  inventory: '庫存',
  'supplied-customers': '今日已供應',
  'execution-cursor': '交付進度',
  'execution-basis': '交付基準狀態',
}

const customerById = new Map(
  customers.map((customer) => [customer.id, customer]),
)
const ingredientById = new Map(
  ingredients.map((ingredient) => [ingredient.id, ingredient]),
)
const ingredientNameById = new Map(
  ingredients.map((ingredient) => [ingredient.id, ingredient.name]),
)
const recipeNameById = new Map(
  recipes.map((recipe) => [recipe.id, recipe.name]),
)
const rawJuiceNameByIngredientId = new Map(
  recipes.flatMap((recipe) =>
    recipe.ingredients.length === 1
      ? ingredients
          .filter((ingredient) => ingredient.name === recipe.ingredients[0])
          .map((ingredient) => [ingredient.id, recipe.name] as const)
      : [],
  ),
)

export const optimizerCriterionOptions: Array<{
  value: OptimizationCriterion
  label: string
}> = [
  { value: 'minimum-machine-operations', label: '最少機器操作' },
  { value: 'minimum-jar-switches', label: '最少果汁罐換裝' },
  { value: 'minimum-cost', label: '最低原料成本' },
  { value: 'minimum-waste', label: '最少剩餘杯' },
  { value: 'maximum-ingredient-cost', label: '最高原料成本' },
  { value: 'maximum-known-revenue', label: '最高已知銷售總額' },
  { value: 'maximum-known-gross-profit', label: '最高已知毛利' },
]

function customerLabel(customerId: string): string {
  const customer = customerById.get(customerId)
  return customer ? optimizerCustomerLabel(customer) : customerId
}

function customerRegionLabel(customerId: string): string | null {
  const customer = customerById.get(customerId)
  return customer
    ? (villageNames[customer.villageId] ?? customer.villageId)
    : null
}

function ingredientLabel(ingredientId: string): string {
  return ingredientNameById.get(ingredientId) ?? ingredientId
}

function sequenceLabel(ingredientIds: readonly string[]): string {
  return formatRecipeSequence(ingredientIds.map(ingredientLabel))
}

export function criterionLabel(criterion: OptimizationCriterion): string {
  if (criterion === 'minimum-cost') return '最低原料成本'
  if (criterion === 'minimum-waste') return '最少剩餘杯'
  if (criterion === 'maximum-ingredient-cost') return '最高原料成本'
  if (criterion === 'maximum-known-revenue') return '最高已知銷售總額'
  if (criterion === 'maximum-known-gross-profit') return '最高已知毛利'
  if (criterion === 'minimum-machine-operations') return '最少機器操作'
  return '最少果汁罐換裝'
}

export function recipePreparationSourceSummary(
  plan: Pick<
    RecipeProductionPlan,
    'recipeId' | 'assignedServings' | 'juiceUnits' | 'producedServings' | 'leftoverServings'
  >,
  preparationShortfall: PreparationShortfall,
): string {
  const stock = preparationShortfall.recipes.find(
    (recipe) => recipe.recipeId === plan.recipeId,
  )

  if (!stock) {
    return [
      `需求 ${plan.assignedServings} 杯`,
      `製作果汁 ${plan.juiceUnits} 份 → ${plan.producedServings} 杯`,
      ...(plan.leftoverServings > 0
        ? [`剩餘 ${plan.leftoverServings} 杯`]
        : []),
    ].join(' · ')
  }

  const parts = [`需求 ${stock.assignedServings} 杯`]

  if (stock.finishedServingsUsed > 0) {
    const sources = stock.finishedStockSources
      .filter((source) => source.servingsUsed > 0)
      .map(
        (source) =>
          `${source.physicalJarId} ${source.servingsUsed} 杯`,
      )

    parts.push(
      `使用既有成品 ${stock.finishedServingsUsed} 杯` +
        (sources.length > 0 ? `（${sources.join('、')}）` : ''),
    )
  }

  if (stock.juiceUnitsToPrepare > 0) {
    parts.push(
      `新製作果汁 ${stock.juiceUnitsToPrepare} 份 → ${stock.newlyProducedServings} 杯`,
    )
    if (stock.newProductionLeftoverServings > 0) {
      parts.push(
        `新製作剩餘 ${stock.newProductionLeftoverServings} 杯`,
      )
    }
  } else {
    parts.push('不需新增製作')
  }

  return parts.join(' · ')
}

export const INVENTORY_RECIPE_SEARCH_RESULT_LIMIT = 8
export const INTERMEDIATE_JUICE_SEARCH_RESULT_LIMIT = 8

export interface IntermediateJuiceInventoryEntry {
  identity: string
  ingredientIds: string[]
  label: string
}

function ingredientIsAvailableAtProgress(
  ingredientId: string,
  currentProgress: ProgressMilestoneId,
): boolean {
  const ingredient = ingredientById.get(ingredientId)
  return ingredient ? ingredientIsAvailable(ingredient, currentProgress) : false
}

export function intermediateJuiceInventoryEntries(
  entries: readonly RecipeCandidatePoolEntry[],
  currentProgress?: ProgressMilestoneId,
): IntermediateJuiceInventoryEntry[] {
  const byIdentity = new Map<string, IntermediateJuiceInventoryEntry>()

  // Every declared juice-base ingredient is valid one-step intermediate stock.
  // Do not derive this catalog by asking the full recipe production path to
  // finalize a one-ingredient recipe: raw juice exists before finalization.
  for (const capability of recipeIngredientCapabilities) {
    if (
      !capability.roles.includes('juice-base') ||
      !capability.baseEquipment ||
      (currentProgress !== undefined &&
        !ingredientIsAvailableAtProgress(capability.ingredientId, currentProgress))
    ) {
      continue
    }
    const ingredientIds = [capability.ingredientId]
    const identity = juiceStateIdentity(ingredientIds)
    byIdentity.set(identity, {
      identity,
      ingredientIds,
      label:
        rawJuiceNameByIngredientId.get(capability.ingredientId) ??
        sequenceLabel(ingredientIds),
    })
  }

  for (const entry of entries) {
    const path = productionPathForIngredientIds(entry.ingredientIds)
    if (!path) continue
    for (const edge of path.edges) {
      if (edge.kind === 'finalizing' || edge.toIngredientIds.length === 0) continue
      const identity = juiceStateIdentity(edge.toIngredientIds)
      if (!byIdentity.has(identity)) {
        byIdentity.set(identity, {
          identity,
          ingredientIds: [...edge.toIngredientIds],
          label: sequenceLabel([...edge.toIngredientIds]),
        })
      }
    }
  }
  return [...byIdentity.values()].sort(
    (a, b) => a.label.localeCompare(b.label, 'zh-Hant') || a.identity.localeCompare(b.identity),
  )
}

export function searchIntermediateJuiceEntries(
  entries: readonly IntermediateJuiceInventoryEntry[],
  query: string,
  limit = INTERMEDIATE_JUICE_SEARCH_RESULT_LIMIT,
): IntermediateJuiceInventoryEntry[] {
  const normalized = normalizeRecipeSearchText(query)
  const boundedLimit = Math.max(0, Math.floor(limit))
  const ranked = entries
    .map((entry) => {
      if (!normalized) return { entry, rank: 0 }
      const label = normalizeRecipeSearchText(entry.label)
      const ingredientIds = normalizeRecipeSearchText(entry.ingredientIds.join(' '))
      const ingredientNameList = entry.ingredientIds.map((ingredientId) =>
        normalizeRecipeSearchText(ingredientLabel(ingredientId)),
      )
      const ingredientIdList = entry.ingredientIds.map((ingredientId) =>
        normalizeRecipeSearchText(ingredientId),
      )
      const ingredientNames = ingredientNameList.join(' ')
      if (label === normalized) return { entry, rank: 0 }
      if (
        entry.ingredientIds.length === 1 &&
        ingredientNameList[0] === normalized
      ) {
        return { entry, rank: 1 }
      }
      if (
        entry.ingredientIds.length === 1 &&
        ingredientIdList[0] === normalized
      ) {
        return { entry, rank: 2 }
      }
      if (label.includes(normalized)) return { entry, rank: 3 }
      if (ingredientNames.includes(normalized)) return { entry, rank: 4 }
      if (ingredientIds.includes(normalized)) return { entry, rank: 5 }
      return null
    })
    .filter(
      (match): match is { entry: IntermediateJuiceInventoryEntry; rank: number } =>
        match !== null,
    )

  if (normalized) {
    ranked.sort(
      (a, b) =>
        a.rank - b.rank ||
        a.entry.label.localeCompare(b.entry.label, 'zh-Hant') ||
        a.entry.identity.localeCompare(b.entry.identity),
    )
  }

  return ranked.slice(0, boundedLimit).map(({ entry }) => entry)
}


export function optimizerInventoryIngredients(
  currentProgress: ProgressMilestoneId,
) {
  return ingredients.filter((ingredient) =>
    ingredientIsAvailable(ingredient, currentProgress),
  )
}

function inventoryRecipeSourceLabel(
  entry: RecipeCandidatePoolEntry,
): string {
  const labels: string[] = []
  if (entry.sources.includes('observed')) labels.push('實測')
  if (entry.sources.includes('personal')) labels.push('個人已確認')
  if (
    entry.sources.includes('saved') &&
    !entry.sources.includes('personal')
  ) {
    labels.push('已保存')
  }
  if (
    entry.sources.includes('computed') &&
    !entry.sources.includes('observed') &&
    !entry.sources.includes('personal')
  ) {
    labels.push('安全推導')
  }
  return labels.join('・')
}

function normalizeRecipeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase('zh-Hant')
}

export function searchInventoryRecipeEntries(
  entries: readonly RecipeCandidatePoolEntry[],
  query: string,
  limit = INVENTORY_RECIPE_SEARCH_RESULT_LIMIT,
): RecipeCandidatePoolEntry[] {
  const normalizedQuery = normalizeRecipeSearchText(query)
  const boundedLimit = Math.max(0, Math.floor(limit))
  if (boundedLimit === 0) return []

  return entries
    .flatMap((entry) => {
      const displayName = formatRecipeDisplayName(entry.candidate.name)
      const normalizedName = normalizeRecipeSearchText(displayName)
      const ingredientNames = normalizeRecipeSearchText(
        entry.candidate.ingredients.join(' '),
      )
      const ingredientIds = normalizeRecipeSearchText(
        entry.ingredientIds.join(' '),
      )
      const candidateId = normalizeRecipeSearchText(entry.candidate.id)

      let score = 0
      if (normalizedQuery) {
        if (
          normalizedName === normalizedQuery ||
          ingredientNames === normalizedQuery ||
          ingredientIds === normalizedQuery ||
          candidateId === normalizedQuery
        ) {
          score = 0
        } else if (
          normalizedName.startsWith(normalizedQuery) ||
          ingredientNames.startsWith(normalizedQuery) ||
          ingredientIds.startsWith(normalizedQuery)
        ) {
          score = 1
        } else if (normalizedName.includes(normalizedQuery)) {
          score = 2
        } else if (ingredientNames.includes(normalizedQuery)) {
          score = 3
        } else if (
          ingredientIds.includes(normalizedQuery) ||
          candidateId.includes(normalizedQuery)
        ) {
          score = 4
        } else {
          return []
        }
      }

      const sourceRank = entry.sources.includes('observed')
        ? 0
        : entry.sources.includes('saved')
          ? 1
          : 2

      return [{ entry, score, sourceRank, displayName }]
    })
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.sourceRank - right.sourceRank ||
        left.displayName.localeCompare(right.displayName, 'zh-Hant') ||
        left.entry.candidate.id.localeCompare(right.entry.candidate.id),
    )
    .slice(0, boundedLimit)
    .map(({ entry }) => entry)
}

export function moveInventoryRecipeSearchIndex(
  currentIndex: number,
  direction: 'next' | 'previous',
  itemCount: number,
): number {
  if (itemCount <= 0) return 0
  if (direction === 'next') {
    return (currentIndex + 1) % itemCount
  }
  return (currentIndex - 1 + itemCount) % itemCount
}

export function JuiceJarRecipeCombobox({
  jarId,
  recipeId,
  entries,
  onChange,
}: {
  jarId: string
  recipeId: string | null
  entries: readonly RecipeCandidatePoolEntry[]
  onChange: (recipeId: string) => void
}) {
  const listboxId = useId()
  const selectedEntry = recipeId
    ? entries.find((entry) => entry.candidate.id === recipeId)
    : undefined
  const selectedLabel = selectedEntry
    ? formatRecipeDisplayName(selectedEntry.candidate.name)
    : recipeId
      ? `既有內容：${recipeId}`
      : '空罐'

  const [query, setQuery] = useState(selectedLabel)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const results = useMemo(
    () =>
      open
        ? searchInventoryRecipeEntries(entries, query)
        : [],
    [entries, open, query],
  )

  useEffect(() => {
    if (!open) setQuery(selectedLabel)
  }, [open, selectedLabel])

  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(0)
  }, [activeIndex, results.length])

  function choose(entry: RecipeCandidatePoolEntry) {
    onChange(entry.candidate.id)
    setQuery(formatRecipeDisplayName(entry.candidate.name))
    setOpen(false)
    setActiveIndex(0)
  }

  return (
    <div
      className="optimizer-recipe-combobox"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false)
        }
      }}
    >
      <div className="optimizer-recipe-combobox-input-row">
        <input
          aria-autocomplete="list"
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open}
          aria-label={`${jarId} 果汁罐內容`}
          aria-activedescendant={
            open && results[activeIndex]
              ? `${listboxId}-option-${activeIndex}`
              : undefined
          }
          role="combobox"
          value={open ? query : selectedLabel}
          onFocus={(event) => {
            setQuery(selectedEntry ? selectedLabel : '')
            setOpen(true)
            setActiveIndex(0)
            event.currentTarget.select()
          }}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActiveIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (!open) {
                setOpen(true)
                setActiveIndex(0)
                return
              }
              setActiveIndex((current) =>
                moveInventoryRecipeSearchIndex(
                  current,
                  'next',
                  results.length,
                ),
              )
              return
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault()
              if (!open) {
                setOpen(true)
                setActiveIndex(0)
                return
              }
              setActiveIndex((current) =>
                moveInventoryRecipeSearchIndex(
                  current,
                  'previous',
                  results.length,
                ),
              )
              return
            }

            if (event.key === 'Enter' && open) {
              const selected = results[activeIndex]
              if (selected) {
                event.preventDefault()
                choose(selected)
              }
              return
            }

            if (event.key === 'Escape' && open) {
              event.preventDefault()
              setOpen(false)
            }
          }}
        />
        {recipeId ? (
          <button
            type="button"
            className="optimizer-recipe-combobox-clear"
            onClick={() => {
              onChange('')
              setQuery('空罐')
              setOpen(false)
              setActiveIndex(0)
            }}
          >
            清空
          </button>
        ) : null}
      </div>

      {open ? (
        <div
          className="optimizer-recipe-combobox-list"
          id={listboxId}
          role="listbox"
        >
          {results.length > 0 ? (
            results.map((entry, index) => (
              <button
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={
                  index === activeIndex
                    ? 'optimizer-recipe-combobox-option active'
                    : 'optimizer-recipe-combobox-option'
                }
                key={entry.candidate.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(entry)}
              >
                <strong>
                  {formatRecipeDisplayName(entry.candidate.name)}
                </strong>
                <span>
                  {formatRecipeSequence(entry.candidate.ingredients)}
                </span>
                <small>{inventoryRecipeSourceLabel(entry)}</small>
              </button>
            ))
          ) : (
            <p className="optimizer-recipe-combobox-empty">
              找不到符合的配方。
            </p>
          )}
          {results.length === INVENTORY_RECIPE_SEARCH_RESULT_LIMIT ? (
            <p className="optimizer-recipe-combobox-hint">
              最多顯示 {INVENTORY_RECIPE_SEARCH_RESULT_LIMIT} 筆；可繼續輸入縮小範圍。
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function IntermediateJuiceCombobox({
  entries,
  onChoose,
}: {
  entries: readonly IntermediateJuiceInventoryEntry[]
  onChoose: (entry: IntermediateJuiceInventoryEntry) => void
}) {
  const listboxId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const results = useMemo(
    () => (open ? searchIntermediateJuiceEntries(entries, query) : []),
    [entries, open, query],
  )
  return (
    <div className="optimizer-recipe-combobox" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}>
      <input
        role="combobox"
        aria-label="新增中間果汁"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        placeholder="搜尋果汁階段…"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
      />
      {open && (
        <div className="optimizer-recipe-combobox-list" id={listboxId} role="listbox">
          {results.length ? results.map((entry) => (
            <button
              type="button"
              role="option"
              aria-selected="false"
              className="optimizer-recipe-combobox-option"
              key={entry.identity}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onChoose(entry); setQuery(''); setOpen(false) }}
            >
              <strong>{entry.label}</strong>
              <small>{entry.ingredientIds.map(ingredientLabel).join(' → ')}</small>
            </button>
          )) : <p className="optimizer-recipe-combobox-empty">找不到可用的中間果汁階段。</p>}
        </div>
      )}
    </div>
  )
}

function jarFillActionLabel(load: MultiTripJuiceJarLoad): string {
  if (load.fillAction === 'use-existing') return '使用既有成品'
  if (load.fillAction === 'continue-loaded') return '沿用罐內成品'
  if (load.fillAction === 'initial-fill') return '首次裝填'
  if (load.fillAction === 'refill-same-type') return '補裝同種'

  return (
    formatRecipeDisplayName(
      load.previousRecipeName ?? load.previousRecipeId ?? '前一種果汁',
    ) +
    ' → ' +
    formatRecipeDisplayName(load.recipeName) +
    ' 換裝'
  )
}

function usedCupPolicyLabel(policy: UsedCupTripPolicy): string {
  return policy === 'retain-and-wash'
    ? '保留杯具並回家清洗'
    : '接受背包滿時 used cup 掉落'
}

function tripPolicyLabel(plan: MultiTripReplenishmentPlan): string {
  return usedCupPolicyLabel(plan.policy)
}

function tripPolicyNote(plan: MultiTripReplenishmentPlan): string {
  return plan.policy === 'retain-and-wash'
    ? '依實際持有杯數逐杯追蹤 clean → used；若回傳 used cup 會超出背包容量，就拆成下一趟，回家後可清洗再重用。'
    : '依實際持有杯數逐杯追蹤 clean → used；只有 NPC 回傳 used cup 當下背包真的放不下時才記為掉落，不把地面視為 storage。'
}

function productionLogisticsActionKindLabel(
  kind: ProductionLogisticsPlan['actions'][number]['kind'],
): string {
  if (kind === 'acquire-ingredient') return '取得原料'
  if (kind === 'fetch-water') return '取水'
  if (kind === 'move-shelf-to-backpack') return '架上取物'
  if (kind === 'move-backpack-to-shelf') return '放回一般架'
  if (kind === 'load-machine') return '放入機器'
  if (kind === 'run-machine') return '機器加工'
  if (kind === 'unload-intermediate') return '取出中間產物'
  return '成品裝罐'
}

function uniquePriorities(
  primary: OptimizationCriterion,
  secondaryOne: OptionalCriterion,
  secondaryTwo: OptionalCriterion,
): OptimizationCriterion[] {
  return [
    primary,
    ...(secondaryOne === 'none' ? [] : [secondaryOne]),
    ...(secondaryTwo === 'none' ? [] : [secondaryTwo]),
  ].filter(
    (criterion, index, values) => values.indexOf(criterion) === index,
  )
}

function OptimizerTools({
  currentProgress,
  satisfactionByVillage,
  suppliedCustomerIds,
  formalCustomerIds,
  recipeCandidatePool,
  onSuppliedCustomerIdsCommitted,
}: OptimizerToolsProps) {
  const [scope, setScope] = useState<OptimizerCustomerScope>('all')
  const [targetMode, setTargetMode] =
    useState<OptimizerCustomerTarget['mode']>('all')
  const [selectedVillageIds, setSelectedVillageIds] =
    useState<VillageId[]>([])
  const [selectedCustomerIds, setSelectedCustomerIds] =
    useState<string[]>([])
  const [customerTargetQuery, setCustomerTargetQuery] = useState('')
  const [candidatePolicy, setCandidatePolicy] =
    useState<OptimizationCandidatePolicy>('trusted-only')
  const [primaryCriterion, setPrimaryCriterion] =
    useState<OptimizationCriterion>('minimum-cost')
  const [secondaryOne, setSecondaryOne] =
    useState<OptionalCriterion>('none')
  const [secondaryTwo, setSecondaryTwo] =
    useState<OptionalCriterion>('none')
  const [inventoryState, setInventoryState] = useState<InventoryState>(() =>
    readInventoryState(window.localStorage),
  )
  const [plannerSettings, setPlannerSettings] = useState<PlannerSettings>(() =>
    readPlannerSettings(window.localStorage, inventoryState),
  )
  const [maxJarTypeSwitches, setMaxJarTypeSwitches] = useState('')
  const [activeWorkshopRegionId, setActiveWorkshopRegionId] =
    useState<VillageId>('east-harbor')
  const [runState, setRunState] = useState<OptimizerRunState>({
    status: 'idle',
  })
  const [applicationState, setApplicationState] =
    useState<PlanApplicationUiState>({ status: 'idle' })
  const [deliveryUiState, setDeliveryUiState] =
    useState<DeliveryUiState>({ status: 'idle' })
  const deliveryCanonicalSyncGuardRef =
    useRef<DeliveryCanonicalSyncGuard | null>(null)
  const optimizerAbortControllerRef =
    useRef<AbortController | null>(null)

  const priorities = useMemo(
    () => uniquePriorities(primaryCriterion, secondaryOne, secondaryTwo),
    [primaryCriterion, secondaryOne, secondaryTwo],
  )

  const availableWorkshopRegions = useMemo(
    () => availableProductionWorkshopRegions(currentProgress),
    [currentProgress],
  )

  const availableInventoryIngredients = useMemo(
    () => optimizerInventoryIngredients(currentProgress),
    [currentProgress],
  )

  const inventoryRecipeEntries = useMemo(
    () =>
      recipeCandidateEntriesForInventoryEditor(recipeCandidatePool).sort(
        (a, b) =>
          a.candidate.name.localeCompare(b.candidate.name, 'zh-Hant') ||
          a.candidate.id.localeCompare(b.candidate.id),
      ),
    [recipeCandidatePool],
  )

  const intermediateInventoryEntries = useMemo(
    () => intermediateJuiceInventoryEntries(inventoryRecipeEntries, currentProgress),
    [inventoryRecipeEntries, currentProgress],
  )

  const accessibleJuiceJars = useMemo(
    () => selectAccessibleJuiceJars(inventoryState),
    [inventoryState],
  )

  const capacitySummary = useMemo(
    () => buildInventoryCapacitySummary(inventoryState, plannerSettings),
    [inventoryState, plannerSettings],
  )

  const canonicalDeliveryUiFingerprint = useMemo(
    () =>
      deliveryExecutionCanonicalBasisFingerprint(
        inventoryState,
        suppliedCustomerIds,
      ),
    [inventoryState, suppliedCustomerIds],
  )

  function persistInventory(next: InventoryState) {
    setInventoryState(next)
    writeInventoryState(window.localStorage, next)
  }

  function persistPlannerSettings(next: PlannerSettings) {
    setPlannerSettings(next)
    writePlannerSettings(window.localStorage, next)
  }

  function setPhysicalJuiceJarCount(count: number) {
    persistInventory(
      resizeJuiceJarInventory(inventoryState, count),
    )
  }

  function setIngredientInventory(
    ingredientId: string,
    quantity: number,
  ) {
    const nextUnits = { ...inventoryState.ingredientUnits }
    const normalized = Math.max(0, Math.floor(quantity))
    if (normalized === 0) {
      delete nextUnits[ingredientId]
    } else {
      nextUnits[ingredientId] = normalized
    }
    persistInventory({
      ...inventoryState,
      ingredientUnits: nextUnits,
    })
  }

  function setIntermediateJuiceInventory(identity: string, quantity: number) {
    const nextUnits = { ...(inventoryState.intermediateJuiceUnits ?? {}) }
    const normalized = Math.max(0, Math.floor(quantity))
    if (normalized === 0) delete nextUnits[identity]
    else nextUnits[identity] = normalized
    persistInventory({ ...inventoryState, intermediateJuiceUnits: nextUnits })
  }

  function updateJuiceJar(
    jarId: string,
    update: (jar: InventoryState['juiceJars'][number]) =>
      InventoryState['juiceJars'][number],
  ) {
    persistInventory({
      ...inventoryState,
      juiceJars: inventoryState.juiceJars.map((jar) =>
        jar.id === jarId ? update(jar) : jar,
      ),
    })
  }

  function setJuiceJarRecipe(
    jarId: string,
    recipeId: string,
  ) {
    updateJuiceJar(jarId, (jar) =>
      recipeId
        ? {
            ...jar,
            recipeId,
            servings: Math.max(1, jar.servings),
          }
        : {
            ...jar,
            recipeId: null,
            servings: 0,
          },
    )
  }

  function setJuiceJarServings(
    jarId: string,
    servings: number,
  ) {
    const normalized = Math.min(
      10,
      Math.max(0, Math.floor(servings)),
    )
    updateJuiceJar(jarId, (jar) =>
      normalized === 0
        ? { ...jar, recipeId: null, servings: 0 }
        : { ...jar, servings: normalized },
    )
  }


  const baseCustomerIds = useMemo(
    () =>
      optimizerCustomerIds(
        customers,
        currentProgress,
        satisfactionByVillage,
        suppliedCustomerIds,
        formalCustomerIds,
        scope,
      ),
    [
      currentProgress,
      satisfactionByVillage,
      suppliedCustomerIds,
      formalCustomerIds,
      scope,
    ],
  )

  const customerTarget = useMemo<OptimizerCustomerTarget>(() => {
    if (targetMode === 'villages') {
      return { mode: 'villages', villageIds: selectedVillageIds }
    }
    if (targetMode === 'customers') {
      return { mode: 'customers', customerIds: selectedCustomerIds }
    }
    return { mode: 'all' }
  }, [targetMode, selectedVillageIds, selectedCustomerIds])

  const customerIds = useMemo(
    () =>
      optimizerCustomerIds(
        customers,
        currentProgress,
        satisfactionByVillage,
        suppliedCustomerIds,
        formalCustomerIds,
        scope,
        customerTarget,
      ),
    [
      currentProgress,
      satisfactionByVillage,
      suppliedCustomerIds,
      formalCustomerIds,
      scope,
      customerTarget,
    ],
  )

  const targetableCustomers = useMemo(() => {
    const eligible = new Set(baseCustomerIds)
    return customers.filter((customer) => eligible.has(customer.id))
  }, [baseCustomerIds])

  const targetableVillageIds = useMemo(
    () =>
      [...new Set(targetableCustomers.map((customer) => customer.villageId))],
    [targetableCustomers],
  )

  const filteredTargetCustomers = useMemo(() => {
    const query = customerTargetQuery.trim().toLocaleLowerCase('zh-Hant')
    if (!query) return targetableCustomers
    return targetableCustomers.filter((customer) =>
      [
        customer.name,
        customer.occupation,
        villageNames[customer.villageId],
      ]
        .join(' ')
        .toLocaleLowerCase('zh-Hant')
        .includes(query),
    )
  }, [customerTargetQuery, targetableCustomers])

  useEffect(() => {
    if (
      availableWorkshopRegions.some(
        (workshop) =>
          workshop.regionId === activeWorkshopRegionId,
      )
    ) {
      return
    }
    const fallback = availableWorkshopRegions[0]
    if (fallback) {
      setActiveWorkshopRegionId(fallback.regionId)
    }
  }, [availableWorkshopRegions, activeWorkshopRegionId])

  useEffect(() => {
    optimizerAbortControllerRef.current?.abort()
    optimizerAbortControllerRef.current = null
    setRunState({ status: 'idle' })
    setDeliveryUiState({ status: 'idle' })
  }, [
    currentProgress,
    satisfactionByVillage,
    formalCustomerIds,
    scope,
    targetMode,
    selectedVillageIds,
    selectedCustomerIds,
    candidatePolicy,
    priorities,
    plannerSettings,
    maxJarTypeSwitches,
    activeWorkshopRegionId,
    recipeCandidatePool,
  ])

  useEffect(
    () => () => {
      optimizerAbortControllerRef.current?.abort()
    },
    [],
  )

  useEffect(() => {
    const guard = deliveryCanonicalSyncGuardRef.current
    if (guard) {
      const status = deliveryCanonicalSyncStatus(
        guard,
        canonicalDeliveryUiFingerprint,
      )
      if (status === 'complete') {
        deliveryCanonicalSyncGuardRef.current = null
        return
      }
      if (status === 'pending') return
      deliveryCanonicalSyncGuardRef.current = null
    }

    setRunState({ status: 'idle' })
    setDeliveryUiState((current) =>
      current.status === 'stale' || current.status === 'error'
        ? current
        : { status: 'idle' },
    )
  }, [canonicalDeliveryUiFingerprint])

  function applyTransactionDraft(
    draft: PlanApplicationTransactionDraft,
  ) {
    const result = commitPlanApplicationTransaction(
      draft,
      window.localStorage,
    )

    if (result.status === 'stale') {
      setApplicationState({
        status: 'stale',
        mismatches: result.mismatches,
      })
      return
    }

    if (result.status === 'error') {
      setApplicationState({
        status: 'error',
        error: presentPlanningError(result.message),
      })
      return
    }

    setInventoryState(result.inventory)
    onSuppliedCustomerIdsCommitted([
      ...result.suppliedCustomerIds,
    ])
    setRunState({ status: 'idle' })
    setApplicationState({ status: 'applied' })
    setDeliveryUiState({ status: 'idle' })
  }

  function commitDeliveryCustomers(
    customerIds: readonly string[],
    supplied: boolean,
  ) {
    if (runState.status !== 'success') return

    const assignedCustomerIds = new Set(
      runState.result.recipePlans.flatMap((plan) => plan.customerIds),
    )
    const targetCustomerIds = customerIds.filter((customerId) =>
      assignedCustomerIds.has(customerId),
    )
    if (targetCustomerIds.length === 0) return

    const beforeSupplied = [...suppliedCustomerIds]
    const nextSupplied = new Set(beforeSupplied)
    for (const customerId of targetCustomerIds) {
      if (supplied) nextSupplied.add(customerId)
      else nextSupplied.delete(customerId)
    }
    const committedSupplied = [...nextSupplied]
    if (
      committedSupplied.length === beforeSupplied.length &&
      committedSupplied.every((customerId) =>
        beforeSupplied.includes(customerId),
      )
    ) {
      return
    }

    // Manual checklist edits are record corrections only. They intentionally
    // do not replay or undo ingredients, intermediate juice, water, cups,
    // physical jar contents, discards, preparation, or trip cursor state.
    const beforeFingerprint =
      deliveryExecutionCanonicalBasisFingerprint(
        inventoryState,
        beforeSupplied,
      )
    const targetFingerprint =
      deliveryExecutionCanonicalBasisFingerprint(
        inventoryState,
        committedSupplied,
      )
    deliveryCanonicalSyncGuardRef.current = {
      targetFingerprint,
      allowedFingerprints: [beforeFingerprint, targetFingerprint],
    }

    writeSuppliedCustomerIds(window.localStorage, committedSupplied)
    onSuppliedCustomerIdsCommitted(committedSupplied)
    setRunState((current) => {
      if (current.status !== 'success') return current

      if (!current.transactionDraft) return current

      const rebasedTransactionDraft =
        rebasePlanApplicationTransactionSuppliedCustomers(
          current.transactionDraft,
          committedSupplied,
        )

      return {
        ...current,
        transactionDraft: rebasedTransactionDraft,
        transactionDraftInvalidatedByPartialDelivery:
          rebasedTransactionDraft === null,
      }
    })
    setApplicationState({ status: 'idle' })
    setDeliveryUiState({
      status: 'applied',
      customerIds: targetCustomerIds,
    })
  }

  function commitDeliveryCustomer(
    customerId: string,
    supplied: boolean,
  ) {
    commitDeliveryCustomers([customerId], supplied)
  }

  async function runOptimizer() {
    optimizerAbortControllerRef.current?.abort()
    const optimizerAbortController = new AbortController()
    optimizerAbortControllerRef.current = optimizerAbortController

    setApplicationState({ status: 'idle' })
    setDeliveryUiState({ status: 'idle' })
    setRunState({ status: 'loading' })

    try {
      const [
        { buildPreparationDemand },
        { buildPreparationShortfall },
        { buildProductionLogisticsPlan },
        { buildRegionPhysicalSalesPlan },
        { buildPlanApplicationTransactionDraft },
      ] = await Promise.all([
        import('./domain/preparationDemand'),
        import('./domain/preparationShortfall'),
        import('./domain/productionLogistics'),
        import('./domain/regionPhysicalSalesPlanner'),
        import('./domain/planApplicationTransaction'),
      ])
      const parsedMaxSwitches =
        maxJarTypeSwitches.trim() === ''
          ? undefined
          : Math.max(0, Math.floor(Number(maxJarTypeSwitches)))

      if (capacitySummary.physicalJuiceJarCount < 1) {
        throw new PlanningUserError('missing-physical-jar')
      }
      if (capacitySummary.jarStorageCapacityExceeded) {
        throw new PlanningUserError('jar-storage-overflow')
      }
      if (capacitySummary.maxJuiceJarSlotsPerTrip < 1) {
        throw new PlanningUserError('missing-jar-slot')
      }

      const result = await runOptimizerInWorker(
        {
          customerIds,
          currentProgress,
          suppliedCustomerIds,
          satisfactionByVillage,
          formalCustomerIds,
          candidatePolicy,
          objective:
            primaryCriterion === 'minimum-machine-operations' ||
            primaryCriterion === 'minimum-jar-switches'
              ? 'minimum-cost'
              : primaryCriterion,
          priorities,
          availableJuiceJarCount:
            capacitySummary.physicalJuiceJarCount,
          initialAvailableJuiceJars: accessibleJuiceJars.map((jar) => ({
            recipeId: jar.recipeId,
            servings: jar.servings,
          })),
          constraints:
            parsedMaxSwitches === undefined ||
            !Number.isFinite(parsedMaxSwitches)
              ? undefined
              : { maxJarTypeSwitches: parsedMaxSwitches },
        },
        {
          customers,
          candidatePool: recipeCandidatePool,
        },
        optimizerAbortController.signal,
      )

      const preparationDemand = buildPreparationDemand(result)
      const preparationShortfall = buildPreparationShortfall(
        preparationDemand,
        inventoryState,
      )
      const selectedPolicy: UsedCupTripPolicy =
        plannerSettings.allowUsedCupDropIfFull
          ? 'allow-drop-if-full'
          : 'retain-and-wash'
      const alternatePolicy: UsedCupTripPolicy =
        selectedPolicy === 'retain-and-wash'
          ? 'allow-drop-if-full'
          : 'retain-and-wash'
      const regionRouting = productionRegionRoutingInput(
        currentProgress,
        activeWorkshopRegionId,
      )
      const customerRegionById =
        productionCustomerRegionById(
          preparationDemand.recipes.flatMap(
            (recipe) => recipe.customerIds,
          ),
        )

      const buildCheckedSalesTripPlan = (
        policy: UsedCupTripPolicy,
      ): {
        plan: MultiTripReplenishmentPlan
        regionPlan: RegionPhysicalSalesPlan
      } => {
        const regionPlan = buildRegionPhysicalSalesPlan({
          demand: preparationDemand,
          shortfall: preparationShortfall,
          policy,
          availableJuiceJarInventory:
            accessibleJuiceJars,
          cups: {
            cleanCups: inventoryState.cleanCups,
            usedCups: inventoryState.usedCups,
          },
          carryPolicy: {
            mode: plannerSettings.juiceJarCarryMode,
            reservedSlots:
              plannerSettings.reservedJuiceJarSlots,
            minimumCarriedSlots:
              capacitySummary.minimumCarriedJuiceJarSlots,
          },
          allowDiscardRetainedJuice:
            plannerSettings.allowDiscardRetainedJuice,
          activeWorkshop: regionRouting.activeWorkshop,
          topology: regionRouting.topology,
          customerRegionById,
        })
        const plan = regionPlan.salesPlan
        // result.jarTypeSwitches is the optimizer's structural lower bound.
        // The physical planner is terminal-aware: prefilled recipes that must
        // remain as final leftovers can require revisiting a jar, so its exact
        // minimum may legitimately be higher (covered by domain regression).
        // The physical schedule is authoritative for the realized count.
        if (
          parsedMaxSwitches !== undefined &&
          Number.isFinite(parsedMaxSwitches) &&
          plan.jarTypeSwitches > parsedMaxSwitches
        ) {
          throw new PlanningUserError(
            'optimizer-no-solution',
            {
              solverStatus: 'physical-jar-switch-limit',
              expectedJarTypeSwitches: parsedMaxSwitches,
              actualJarTypeSwitches: plan.jarTypeSwitches,
            },
            `Terminal-aware physical schedule requires ${plan.jarTypeSwitches} jar switch(es), exceeding the configured maximum of ${parsedMaxSwitches}`,
          )
        }
        return { plan, regionPlan }
      }

      const selectedSalesTripBuild =
        buildCheckedSalesTripPlan(selectedPolicy)
      const selectedSalesTripPlan =
        selectedSalesTripBuild.plan
      const selectedRegionSalesPlan =
        selectedSalesTripBuild.regionPlan
      const productionLogistics = buildProductionLogisticsPlan(
        preparationShortfall,
        inventoryState,
        plannerSettings,
        selectedSalesTripPlan.productionJarFills,
      )
      let alternateSalesTripPlan: MultiTripReplenishmentPlan | null = null
      let alternateRegionSalesPlan: RegionPhysicalSalesPlan | null = null
      let alternateError: string | null = null
      try {
        const alternateSalesTripBuild =
          buildCheckedSalesTripPlan(alternatePolicy)
        alternateSalesTripPlan =
          alternateSalesTripBuild.plan
        alternateRegionSalesPlan =
          alternateSalesTripBuild.regionPlan
      } catch (error) {
        alternateError = presentPlanningError(error).message
      }

      const salesTripPlans: SalesTripPlans = {
        selected: selectedSalesTripPlan,
        selectedRegion: selectedRegionSalesPlan,
        alternate: alternateSalesTripPlan,
        alternateRegion: alternateRegionSalesPlan,
        alternatePolicy,
        alternateError,
      }
      const transactionDraft = productionLogistics.feasible
        ? buildPlanApplicationTransactionDraft({
            basis: {
              inventory: inventoryState,
              currentProgress,
              satisfactionByVillage,
              formalCustomerIds,
              suppliedCustomerIds,
              plannerSettings,
            },
            result,
            preparationShortfall,
            productionLogistics,
            salesPlan: selectedSalesTripPlan,
          })
        : null
      const deliveryExecutionPlan = productionLogistics.feasible
        ? buildDeliveryExecutionPlan(
            preparationShortfall,
            selectedSalesTripPlan,
          )
        : null
      const deliveryCursor = deliveryExecutionPlan
        ? createDeliveryExecutionCursor(deliveryExecutionPlan)
        : null

      setRunState({
        status: 'success',
        result,
        preparationShortfall,
        productionLogistics,
        salesTripPlans,
        transactionDraft,
        transactionDraftInvalidatedByPartialDelivery: false,
        deliveryExecutionPlan,
        deliveryCursor,
        deliveryExpectedBasis: {
          inventory: inventoryState,
          suppliedCustomerIds: [...suppliedCustomerIds],
        },
      })
    } catch (error) {
      if (isOptimizerWorkerCancelledError(error)) {
        if (
          optimizerAbortControllerRef.current === optimizerAbortController
        ) {
          setRunState({ status: 'idle' })
        }
        return
      }
      setRunState({
        status: 'error',
        error: presentPlanningError(error),
      })
    } finally {
      if (
        optimizerAbortControllerRef.current === optimizerAbortController
      ) {
        optimizerAbortControllerRef.current = null
      }
    }
  }

  function cancelOptimizer() {
    optimizerAbortControllerRef.current?.abort()
    optimizerAbortControllerRef.current = null
    setRunState({ status: 'idle' })
  }

  return (
    <section className="optimizer-tools" aria-label="最佳化規劃">
      <div className="tool-panel optimizer-control-panel">
        <div className="tool-heading">
          <div>
            <p className="tool-kicker">Production Optimizer</p>
            <h2>全日製作與販售規劃</h2>
          </div>
          <span className="tool-badge">{customerIds.length} 人需求</span>
        </div>

        <p className="tool-description">
          以 full match 顧客分配為基礎，同時計算實際果汁份數、1～5 份製作 stack、共享中間半成品、機器操作、果汁罐換裝與 downstream production logistics。路線仍不自行推導；果汁調和器 1:1:1、q = 1～5 已接入 production graph。
        </p>

        <div className="optimizer-controls">
          <fieldset>
            <legend>顧客身分</legend>
            <div className="segmented-control">
              <button
                type="button"
                className={scope === 'all' ? 'active' : ''}
                onClick={() => setScope('all')}
              >
                全部
              </button>
              <button
                type="button"
                className={scope === 'potential' ? 'active' : ''}
                onClick={() => setScope('potential')}
              >
                潛在顧客
              </button>
              <button
                type="button"
                className={scope === 'formal' ? 'active' : ''}
                onClick={() => setScope('formal')}
              >
                正式顧客
              </button>
            </div>
          </fieldset>

          <fieldset>
            <legend>規劃對象</legend>
            <div className="segmented-control">
              <button
                type="button"
                className={targetMode === 'all' ? 'active' : ''}
                onClick={() => setTargetMode('all')}
              >
                全部符合條件
              </button>
              <button
                type="button"
                className={targetMode === 'villages' ? 'active' : ''}
                onClick={() => setTargetMode('villages')}
              >
                指定村莊
              </button>
              <button
                type="button"
                className={targetMode === 'customers' ? 'active' : ''}
                onClick={() => setTargetMode('customers')}
              >
                自選顧客
              </button>
            </div>
          </fieldset>

          <label>
            <span>配方證據</span>
            <select
              value={candidatePolicy}
              onChange={(event) =>
                setCandidatePolicy(
                  event.target.value as OptimizationCandidatePolicy,
                )
              }
            >
              <option value="trusted-only">
                正式實測＋已確認個人配方
              </option>
              <option value="allow-unambiguous-computed">
                正式實測＋已確認個人配方＋無歧義預測
              </option>
            </select>
          </label>

          <label>
            <span>主要目標</span>
            <select
              value={primaryCriterion}
              onChange={(event) =>
                setPrimaryCriterion(
                  event.target.value as OptimizationCriterion,
                )
              }
            >
              {optimizerCriterionOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <PrioritySelect
            label="次要目標 1"
            value={secondaryOne}
            onChange={setSecondaryOne}
          />
          <PrioritySelect
            label="次要目標 2"
            value={secondaryTwo}
            onChange={setSecondaryTwo}
          />

          <label className="optimizer-checkbox-control">
            <input
              type="checkbox"
              checked={plannerSettings.allowUsedCupDropIfFull}
              onChange={(event) =>
                persistPlannerSettings({
                  ...plannerSettings,
                  allowUsedCupDropIfFull: event.target.checked,
                })
              }
            />
            <span>接受背包滿時 used cup 可能掉落</span>
          </label>

          <label className="optimizer-checkbox-control">
            <input
              type="checkbox"
              checked={plannerSettings.allowDiscardRetainedJuice}
              onChange={(event) =>
                persistPlannerSettings({
                  ...plannerSettings,
                  allowDiscardRetainedJuice: event.target.checked,
                })
              }
            />
            <span>必要時允許倒掉既有果汁以騰出果汁罐</span>
          </label>

          <label>
            <span>最大果汁罐換裝次數</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="不限制"
              value={maxJarTypeSwitches}
              onChange={(event) => setMaxJarTypeSwitches(event.target.value)}
            />
          </label>
        </div>

        {targetMode === 'villages' && (
          <section
            className="optimizer-customer-target-panel"
            aria-label="規劃村莊"
          >
            <div className="optimizer-target-toolbar">
              <strong>規劃村莊</strong>
              <span>
                已選 {selectedVillageIds.filter((villageId) =>
                  targetableVillageIds.includes(villageId),
                ).length}{' '}
                / {targetableVillageIds.length} 個村莊 · 本次 {customerIds.length} 人
              </span>
            </div>
            <div className="optimizer-target-options">
              {targetableVillageIds.map((villageId) => (
                <label className="optimizer-target-option" key={villageId}>
                  <input
                    type="checkbox"
                    checked={selectedVillageIds.includes(villageId)}
                    onChange={(event) =>
                      setSelectedVillageIds((current) =>
                        event.target.checked
                          ? [...current, villageId]
                          : current.filter((item) => item !== villageId),
                      )
                    }
                  />
                  <span>{villageNames[villageId]}</span>
                </label>
              ))}
            </div>
            {targetableVillageIds.length === 0 && (
              <p className="optimizer-target-empty">
                目前顧客身分條件下沒有可規劃的村莊。
              </p>
            )}
          </section>
        )}

        {targetMode === 'customers' && (
          <section
            className="optimizer-customer-target-panel"
            aria-label="自選規劃顧客"
          >
            <div className="optimizer-target-toolbar">
              <strong>個別顧客</strong>
              <span>
                已選 {customerIds.length} / {baseCustomerIds.length} 人
              </span>
            </div>
            <div className="optimizer-target-actions">
              <input
                type="search"
                value={customerTargetQuery}
                placeholder="搜尋姓名、職業或村莊"
                aria-label="搜尋規劃顧客"
                onChange={(event) => setCustomerTargetQuery(event.target.value)}
              />
              <button
                type="button"
                onClick={() =>
                  setSelectedCustomerIds((current) => [
                    ...new Set([
                      ...current,
                      ...filteredTargetCustomers.map((customer) => customer.id),
                    ]),
                  ])
                }
                disabled={filteredTargetCustomers.length === 0}
              >
                全選搜尋結果
              </button>
              <button
                type="button"
                onClick={() => setSelectedCustomerIds([])}
                disabled={selectedCustomerIds.length === 0}
              >
                清空
              </button>
            </div>
            <div className="optimizer-customer-target-list">
              {filteredTargetCustomers.map((customer) => (
                <label className="optimizer-target-option" key={customer.id}>
                  <input
                    type="checkbox"
                    checked={selectedCustomerIds.includes(customer.id)}
                    onChange={(event) =>
                      setSelectedCustomerIds((current) =>
                        event.target.checked
                          ? [...current, customer.id]
                          : current.filter((item) => item !== customer.id),
                      )
                    }
                  />
                  <span>
                    <strong>{optimizerCustomerLabel(customer)}</strong>
                    <small>{villageNames[customer.villageId]}</small>
                  </span>
                </label>
              ))}
              {filteredTargetCustomers.length === 0 && (
                <p className="optimizer-target-empty">
                  找不到符合搜尋條件的可規劃顧客。
                </p>
              )}
            </div>
          </section>
        )}

        <section
          className="optimizer-inventory-editor"
          aria-label="販售工作間與區域路線"
        >
          <div className="section-title">
            <strong>販售工作間與區域路線</strong>
            <span>Region 粗粒度規劃；村內顧客順序仍由玩家安排</span>
          </div>
          <div className="optimizer-inventory-grid">
            <label>
              <span>本次出發／補給工作間</span>
              <select
                value={activeWorkshopRegionId}
                onChange={(event) =>
                  setActiveWorkshopRegionId(
                    event.target.value as VillageId,
                  )
                }
              >
                {availableWorkshopRegions.map((workshop) => (
                  <option
                    key={workshop.id}
                    value={workshop.regionId}
                  >
                    {workshop.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="optimizer-inventory-empty">
            只列目前主線已解鎖、且已進 production 的 Region 工作間；跨區只使用已確認的 Region adjacency，第一版每條已確認 edge 成本視為 1。西部城堡尚未進 production Region identity，因此不會從未啟用資料推入本次規劃。
          </p>
        </section>

        <section className="optimizer-inventory-editor">
          <div className="section-title">
            <strong>實際庫存</strong>
            <span>直接保存到 mjc-inventory；果汁罐攜帶選擇保存到 planner settings</span>
          </div>

          <div className="optimizer-inventory-grid">
            <label>
              <span>水</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={inventoryState.waterUnits}
                onChange={(event) =>
                  persistInventory({
                    ...inventoryState,
                    waterUnits: Math.max(
                      0,
                      Math.floor(Number(event.target.value) || 0),
                    ),
                  })
                }
              />
            </label>
            <label>
              <span>乾淨杯</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={inventoryState.cleanCups}
                onChange={(event) =>
                  persistInventory({
                    ...inventoryState,
                    cleanCups: Math.max(
                      0,
                      Math.floor(Number(event.target.value) || 0),
                    ),
                  })
                }
              />
            </label>
            <label>
              <span>用過的杯子</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={inventoryState.usedCups}
                onChange={(event) =>
                  persistInventory({
                    ...inventoryState,
                    usedCups: Math.max(
                      0,
                      Math.floor(Number(event.target.value) || 0),
                    ),
                  })
                }
              />
            </label>
            <label>
              <span>一般架子</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={inventoryState.shelfCount}
                onChange={(event) =>
                  persistInventory({
                    ...inventoryState,
                    shelfCount: Math.max(
                      0,
                      Math.floor(Number(event.target.value) || 0),
                    ),
                  })
                }
              />
            </label>
            <label>
              <span>果汁罐架</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={inventoryState.jarRackCount}
                onChange={(event) =>
                  persistInventory({
                    ...inventoryState,
                    jarRackCount: Math.max(
                      0,
                      Math.floor(Number(event.target.value) || 0),
                    ),
                  })
                }
              />
            </label>
            <label>
              <span>實際持有果汁罐</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={inventoryState.juiceJars.length}
                onChange={(event) =>
                  setPhysicalJuiceJarCount(
                    Math.max(
                      0,
                      Math.floor(Number(event.target.value) || 0),
                    ),
                  )
                }
              />
            </label>
          </div>

          <div className="optimizer-inventory-subsection">
            <strong>原料庫存</strong>
            <div className="optimizer-ingredient-inventory">
              {availableInventoryIngredients.map((ingredient) => (
                <label key={ingredient.id}>
                  <span>{ingredient.name}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={inventoryState.ingredientUnits[ingredient.id] ?? 0}
                    onChange={(event) =>
                      setIngredientInventory(
                        ingredient.id,
                        Number(event.target.value) || 0,
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="optimizer-inventory-subsection">
            <div className="optimizer-inventory-subheading">
              <strong>中間果汁庫存</strong>
              <span>以果汁單位計；只記錄尚未加水成為販售成品的階段</span>
            </div>
            <IntermediateJuiceCombobox
              entries={intermediateInventoryEntries.filter(
                (entry) => !(entry.identity in (inventoryState.intermediateJuiceUnits ?? {})),
              )}
              onChoose={(entry) => setIntermediateJuiceInventory(entry.identity, 1)}
            />
            {Object.keys(inventoryState.intermediateJuiceUnits ?? {}).length === 0 ? (
              <p className="optimizer-inventory-empty">目前沒有中間果汁庫存。</p>
            ) : (
              <div className="optimizer-ingredient-inventory">
                {Object.entries(inventoryState.intermediateJuiceUnits ?? {})
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([identity, units]) => {
                    const entry = intermediateInventoryEntries.find((item) => item.identity === identity)
                    return (
                      <label key={identity}>
                        <span>{entry?.label ?? identity}</span>
                        <input
                          aria-label={`${entry?.label ?? identity} 中間果汁單位`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={units}
                          onChange={(event) => setIntermediateJuiceInventory(identity, Number(event.target.value) || 0)}
                        />
                      </label>
                    )
                  })}
              </div>
            )}
          </div>

          <div className="optimizer-inventory-subsection">
            <div className="optimizer-inventory-subheading">
              <strong>果汁罐</strong>
              <span>
                {inventoryState.jarRackCount === 0
                  ? `無果汁罐架：${capacitySummary.physicalJuiceJarCount} 個都必須隨身`
                  : plannerSettings.juiceJarCarryMode === 'auto'
                    ? '每趟自動計算攜帶數量'
                    : `固定使用 ${capacitySummary.effectiveReservedJuiceJarSlots} 個果汁罐格`}
              </span>
            </div>

            {inventoryState.jarRackCount > 0 && (
              <div className="optimizer-inventory-grid">
                <label>
                  <span>出門果汁罐格</span>
                  <select
                    value={plannerSettings.juiceJarCarryMode}
                    onChange={(event) =>
                      persistPlannerSettings({
                        ...plannerSettings,
                        juiceJarCarryMode:
                          event.target.value === 'fixed-slots'
                            ? 'fixed-slots'
                            : 'auto',
                      })
                    }
                  >
                    <option value="auto">每趟自動計算</option>
                    <option value="fixed-slots">固定格數</option>
                  </select>
                </label>
                {plannerSettings.juiceJarCarryMode === 'fixed-slots' && (
                  <label>
                    <span>固定果汁罐格數</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={Math.min(
                        10,
                        capacitySummary.physicalJuiceJarCount,
                      )}
                      value={plannerSettings.reservedJuiceJarSlots}
                      onChange={(event) =>
                        persistPlannerSettings({
                          ...plannerSettings,
                          reservedJuiceJarSlots: Math.min(
                            10,
                            Math.max(
                              0,
                              Math.floor(
                                Number(event.target.value) || 0,
                              ),
                            ),
                          ),
                        })
                      }
                    />
                  </label>
                )}
              </div>
            )}

            {capacitySummary.minimumCarriedJuiceJarSlots > 0 &&
              inventoryState.jarRackCount > 0 && (
                <p className="optimizer-inventory-empty">
                  果汁罐架目前最多能放
                  {' '}{capacitySummary.jarRackStagingCapacity} 個罐子，因此至少
                  {' '}{capacitySummary.minimumCarriedJuiceJarSlots} 個果汁罐必須留在背包。
                </p>
              )}

            <p className="optimizer-inventory-empty">
              果汁罐內容可搜尋目前可用的實測、個人已保存與安全推導配方；每次只顯示少量匹配結果，不會把數千個推導候選全部 render 成選項。
            </p>

            {inventoryState.juiceJars.length === 0 ? (
              <p className="optimizer-inventory-empty">
                目前沒有實體果汁罐。
              </p>
            ) : (
              <div className="optimizer-jar-inventory">
                {inventoryState.juiceJars.map((jar) => (
                  <article className="optimizer-jar-card" key={jar.id}>
                    <div className="optimizer-jar-heading">
                      <strong>{jar.id}</strong>
                    </div>
                    <label>
                      <span>內容</span>
                      <JuiceJarRecipeCombobox
                        jarId={jar.id}
                        recipeId={jar.recipeId}
                        entries={inventoryRecipeEntries}
                        onChange={(recipeId) =>
                          setJuiceJarRecipe(jar.id, recipeId)
                        }
                      />
                    </label>
                    <label>
                      <span>杯數</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={jar.recipeId ? 1 : 0}
                        max={10}
                        disabled={!jar.recipeId}
                        value={jar.servings}
                        onChange={(event) =>
                          setJuiceJarServings(
                            jar.id,
                            Number(event.target.value) || 0,
                          )
                        }
                      />
                    </label>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <div className="optimizer-demand-summary">
          <strong>本次需求：{customerIds.length} 人</strong>
          <span>最佳化順序：{priorities.map(criterionLabel).join(' → ')}</span>
          <span>
            果汁罐：持有 {capacitySummary.physicalJuiceJarCount}
            {' · '}
            {inventoryState.jarRackCount === 0
              ? `無果汁罐架，全部 ${capacitySummary.physicalJuiceJarCount} 個必須隨身`
              : plannerSettings.juiceJarCarryMode === 'auto'
                ? `每趟自動計算（最低隨身 ${capacitySummary.minimumCarriedJuiceJarSlots} 個）`
                : `固定使用 ${capacitySummary.effectiveReservedJuiceJarSlots} 個果汁罐格`}
            {maxJarTypeSwitches.trim() !== ''
              ? ' · 最多換裝 ' + maxJarTypeSwitches + ' 次'
              : ' · 換裝不限'}
            {plannerSettings.allowDiscardRetainedJuice
              ? ' · 必要時可倒掉既有果汁'
              : ' · 保留既有果汁'}
          </span>
          <span>
            一般架子 {inventoryState.shelfCount} 架 /{' '}
            {capacitySummary.shelfSlotCapacity} 格 · 果汁罐架{' '}
            {inventoryState.jarRackCount} 架 /{' '}
            {capacitySummary.jarRackStagingCapacity} 格
          </span>
          <span>
            目前至少占用／固定使用
            {' '}{capacitySummary.effectiveReservedJuiceJarSlots} / 10 個背包格；
            其他搬運至少剩
            {' '}{capacitySummary.backpackSlotsRemainingAfterCarriedJars} 格
          </span>
        </div>

        {capacitySummary.physicalJuiceJarCount < 1 && (
          <p className="optimizer-capacity-warning" role="status">
            請先設定至少 1 個實際持有的果汁罐。
          </p>
        )}
        {capacitySummary.jarStorageCapacityExceeded && (
          <p className="optimizer-capacity-warning" role="status">
            目前持有的果汁罐超過果汁罐架與背包合計可容納的數量。
          </p>
        )}
        {capacitySummary.physicalJuiceJarCount > 0 &&
          !capacitySummary.jarStorageCapacityExceeded &&
          capacitySummary.maxJuiceJarSlotsPerTrip < 1 && (
            <p className="optimizer-capacity-warning" role="status">
              固定果汁罐格數至少需要 1 格，或改用「每趟自動計算」。
            </p>
          )}

        <div className="optimizer-run-actions">
          <button
            type="button"
            className="optimizer-run-button"
            disabled={
              customerIds.length === 0 ||
              runState.status === 'loading' ||
              capacitySummary.physicalJuiceJarCount < 1 ||
              capacitySummary.jarStorageCapacityExceeded ||
              capacitySummary.maxJuiceJarSlotsPerTrip < 1
            }
            onClick={runOptimizer}
          >
            {runState.status === 'loading'
              ? '正在背景求解並規劃…'
              : '產生最佳化規劃'}
          </button>
          {runState.status === 'loading' && (
            <button
              type="button"
              className="optimizer-cancel-button"
              onClick={cancelOptimizer}
            >
              取消規劃
            </button>
          )}
        </div>

        <p className="optimizer-lazy-note">
          求解器只會在按下規劃後載入，並在背景 Worker 執行 HiGHS；第一次執行仍需要載入 WASM。大型候選或一般 fallback 可能需要較久，可隨時取消且不會寫入半成品結果。
        </p>
      </div>

      {runState.status === 'error' && (
        <PlanningErrorBlock presentation={runState.error} />
      )}

      {applicationState.status === 'applied' && (
        <div className="optimizer-result-note" role="status">
          <strong>規劃已完整寫入。</strong>
          <span>
            庫存與今日已供應狀態已更新；舊規劃已清除。需要繼續安排剩餘顧客時，請重新產生最佳化規劃。
          </span>
        </div>
      )}

      {applicationState.status === 'stale' && (
        <div className="optimizer-error" role="alert">
          <strong>規劃已過期，未寫入任何變更</strong>
          <span>
            已變更：
            {applicationState.mismatches
              .map((field) => planApplicationMismatchLabels[field])
              .join('、')}
            。請重新產生最佳化規劃。
          </span>
        </div>
      )}

      {applicationState.status === 'error' && (
        <PlanningErrorBlock presentation={applicationState.error} />
      )}

      {deliveryUiState.status === 'applied' && (
        <div className="optimizer-result-note" role="status">
          <strong>
            已記錄今日供應：
            {deliveryUiState.customerIds.map(customerLabel).join('、')}
          </strong>
          <span>
            這次手動勾選只更新「今日已供應」；不修改庫存、果汁罐、杯具或製作狀態。若這些勾選都屬於目前這份規劃，整份套用預覽會保留並以新的今日供應狀態重新對齊，仍可回頭確認套用物資變更；若只需要重排尚未送達顧客的行程，也可使用下方「剩餘販售重排」。
          </span>
        </div>
      )}

      {deliveryUiState.status === 'stale' && (
        <div className="optimizer-error" role="alert">
          <strong>交付排程已過期，未寫入任何變更</strong>
          <span>
            已變更：
            {deliveryUiState.mismatches
              .map((field) => deliveryMismatchLabels[field])
              .join('、')}
            。目前 canonical 狀態已重新讀取，請重新產生最佳化規劃。
          </span>
        </div>
      )}

      {deliveryUiState.status === 'error' && runState.status !== 'success' && (
        <div className="optimizer-error" role="alert">
          <strong>交付沒有寫入</strong>
          <span>{deliveryUiState.message}</span>
        </div>
      )}

      {runState.status === 'success' && (
        <OptimizerResultPanel
          result={runState.result}
          currentProgress={currentProgress}
          activeWorkshopRegionId={activeWorkshopRegionId}
          preparationShortfall={runState.preparationShortfall}
          productionLogistics={runState.productionLogistics}
          priorities={priorities}
          salesTripPlans={runState.salesTripPlans}
          transactionDraft={runState.transactionDraft}
          transactionDraftInvalidatedByPartialDelivery={
            runState.transactionDraftInvalidatedByPartialDelivery
          }
          deliveryExecutionPlan={runState.deliveryExecutionPlan}
          deliveryCursor={runState.deliveryCursor}
          suppliedCustomerIds={suppliedCustomerIds}
          deliveryUiState={deliveryUiState}
          onApplyTransaction={applyTransactionDraft}
          onCommitDelivery={commitDeliveryCustomer}
          onCommitDeliveryGroup={commitDeliveryCustomers}
        />
      )}
    </section>
  )
}

export default memo(OptimizerTools)

export function PlanningErrorBlock({
  presentation,
}: {
  presentation: PlanningErrorPresentation
}) {
  return (
    <div className="optimizer-error" role="alert">
      <strong>{presentation.title}</strong>
      <span>{presentation.message}</span>
      {presentation.suggestions.length > 0 && (
        <ul className="optimizer-error-suggestions">
          {presentation.suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ul>
      )}
      {presentation.technicalDetails && (
        <details className="optimizer-error-details">
          <summary>技術資訊</summary>
          <code>{presentation.technicalDetails}</code>
        </details>
      )}
    </div>
  )
}

function PrioritySelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: OptionalCriterion
  onChange: (value: OptionalCriterion) => void
}) {
  return (
    <label>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) =>
          onChange(event.target.value as OptionalCriterion)
        }
      >
        <option value="none">不指定</option>
        {optimizerCriterionOptions.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

type ProductionStep =
  ProductionLogisticsPlan['productionPlan']['steps'][number]

function MachineSlotPill({
  role,
  label,
}: {
  role: string
  label: string
}) {
  return (
    <span className="optimizer-slot-pill">
      <small>{role}</small>
      <strong>{label}</strong>
    </span>
  )
}

export function ProductionStepFinalJuiceNote({
  stepKind,
  readyForFinalizingUnits,
}: {
  stepKind: ProductionStep['kind']
  readyForFinalizingUnits: number
}) {
  if (
    readyForFinalizingUnits <= 0 ||
    (stepKind !== 'seasoning' && stepKind !== 'blending')
  ) {
    return null
  }

  return (
    <p className="optimizer-final-juice-note">
      其中 {readyForFinalizingUnits} 份為最終果汁（下一步進果汁成品台）
    </p>
  )
}

export function SeasoningStepStageUsageNote({
  quantity,
  stillNeededUnits,
}: {
  quantity: number
  stillNeededUnits?: number
}) {
  if (stillNeededUnits === undefined) return null

  const normalizedStillNeeded = Math.max(
    0,
    Math.min(quantity, stillNeededUnits),
  )
  const canRackUnits = Math.max(0, quantity - normalizedStillNeeded)

  if (quantity <= 0) return null

  return (
    <p className="optimizer-seasoning-stage-usage">
      {normalizedStillNeeded > 0 && (
        <span>本階段還會用到 {normalizedStillNeeded} 份</span>
      )}
      {canRackUnits > 0 && (
        <span>本階段不再使用 {canRackUnits} 份，可先放架上</span>
      )}
    </p>
  )
}

export function SeasoningStageMaterialSummary({
  ingredientUnits,
  baseJuiceUnits,
}: {
  ingredientUnits: Readonly<Record<string, number>>
  baseJuiceUnits: Readonly<Record<string, number>>
}) {
  const ingredientEntries = Object.entries(ingredientUnits)
    .filter(([, quantity]) => quantity > 0)
    .map(([ingredientId, quantity]) =>
      `${ingredientLabel(ingredientId)} ×${quantity}`,
    )
  const baseJuiceEntries = Object.entries(baseJuiceUnits)
    .filter(([, quantity]) => quantity > 0)
    .map(([ingredientId, quantity]) =>
      `${ingredientLabel(ingredientId)}原汁 ×${quantity}`,
    )

  if (
    ingredientEntries.length === 0 &&
    baseJuiceEntries.length === 0
  ) {
    return null
  }

  return (
    <small className="optimizer-machine-material-summary">
      {ingredientEntries.length > 0 && (
        <span>本階段材料：{ingredientEntries.join('、')}</span>
      )}
      {baseJuiceEntries.length > 0 && (
        <span>
          本階段基礎果汁：{baseJuiceEntries.join('、')}
        </span>
      )}
    </small>
  )
}

export function MachineBatchFlow({
  step,
  quantity,
  batchIndex,
  completed,
  onCompletedChange,
}: {
  step: ProductionStep
  quantity: number
  batchIndex: number
  completed: boolean
  onCompletedChange: (completed: boolean) => void
}) {
  const outputQuantity =
    step.kind === 'finalizing' ? quantity * 2 : quantity
  const outputLabel =
    step.kind === 'juicing'
      ? sequenceLabel(step.toIngredientIds) + '原汁'
      : step.kind === 'finalizing'
        ? sequenceLabel(step.toIngredientIds) + '成品'
        : sequenceLabel(step.toIngredientIds)

  return (
    <label
      className={
        completed
          ? 'optimizer-operation-flow completed'
          : 'optimizer-operation-flow'
      }
    >
      <input
        className="optimizer-operation-checkbox"
        type="checkbox"
        checked={completed}
        onChange={(event) =>
          onCompletedChange(event.target.checked)
        }
        aria-label={
          `第 ${batchIndex + 1} 批完成：${productionStepLabel(step)}`
        }
      />
      <span className="optimizer-batch-index">
        第 {batchIndex + 1} 批
      </span>
      <div className="optimizer-slot-flow">
        {step.kind === 'juicing' ? (
          <MachineSlotPill
            role="input"
            label={
              ingredientLabel(step.addedIngredientId ?? '') +
              ' ×' +
              quantity
            }
          />
        ) : (
          <MachineSlotPill
            role={step.kind === 'blending' ? 'input A' : '果汁 input'}
            label={sequenceLabel(step.fromIngredientIds) + ' ×' + quantity}
          />
        )}

        {(step.kind === 'seasoning' ||
          step.kind === 'blending' ||
          step.kind === 'finalizing') && (
          <span className="optimizer-slot-operator">＋</span>
        )}

        {step.kind === 'seasoning' && (
          <MachineSlotPill
            role="調味 input"
            label={
              ingredientLabel(step.addedIngredientId ?? '') +
              ' ×' +
              quantity
            }
          />
        )}

        {step.kind === 'blending' && (
          <MachineSlotPill
            role="input B"
            label={
              sequenceLabel(step.secondaryFromIngredientIds ?? []) +
              ' ×' +
              quantity
            }
          />
        )}

        {step.kind === 'finalizing' && (
          <MachineSlotPill
            role="水 input"
            label={'水 ×' + quantity}
          />
        )}

        <span className="optimizer-slot-arrow" aria-hidden="true">
          →
        </span>
        <MachineSlotPill
          role="output"
          label={
            outputLabel +
            ' ×' +
            outputQuantity +
            (step.kind === 'finalizing' ? '杯' : '')
          }
        />
      </div>
    </label>
  )
}

function productionStepLabel(
  step: ProductionLogisticsPlan['productionPlan']['steps'][number],
): string {
  if (step.kind === 'juicing') {
    return ingredientLabel(step.addedIngredientId ?? '') + ' → 原汁'
  }
  if (step.kind === 'seasoning') {
    return (
      sequenceLabel(step.fromIngredientIds) +
      ' + ' +
      ingredientLabel(step.addedIngredientId ?? '') +
      ' → ' +
      sequenceLabel(step.toIngredientIds)
    )
  }
  if (step.kind === 'blending') {
    return (
      sequenceLabel(step.fromIngredientIds) +
      ' + ' +
      sequenceLabel(step.secondaryFromIngredientIds ?? []) +
      ' → ' +
      sequenceLabel(step.toIngredientIds)
    )
  }
  return sequenceLabel(step.fromIngredientIds) + ' + 水 → 販售成品'
}


function transactionRecipeLabel(
  recipeId: string | null,
  fills: readonly MultiTripProductionJarFill[],
): string {
  if (!recipeId) return '空罐'
  const fill = fills.find((item) => item.recipeId === recipeId)
  return formatRecipeDisplayName(
    fill?.recipeName ?? recipeNameById.get(recipeId) ?? recipeId,
  )
}

function transactionJarContentLabel(
  jar: {
    recipeId: string | null
    servings: number
  },
  fills: readonly MultiTripProductionJarFill[],
): string {
  if (!jar.recipeId || jar.servings <= 0) return '空罐'
  return (
    transactionRecipeLabel(jar.recipeId, fills) +
    ' · ' +
    jar.servings +
    ' 杯'
  )
}

function transactionJarChangeLabel(
  change: PlanApplicationTransactionDraft['changes']['juiceJars'][number],
): string {
  const beforeFilled =
    Boolean(change.before.recipeId) && change.before.servings > 0
  const afterFilled =
    Boolean(change.after.recipeId) && change.after.servings > 0

  if (!beforeFilled && afterFilled) return '裝入成品'
  if (beforeFilled && !afterFilled) return '清空'
  if (change.before.recipeId !== change.after.recipeId) return '換裝'
  if (change.after.servings > change.before.servings) return '補裝同種'
  if (change.after.servings < change.before.servings) return '販售後保留'
  return '內容更新'
}

function transactionFillActionLabel(
  fill: MultiTripProductionJarFill,
): string {
  if (fill.fillAction === 'initial-fill') return '首次裝填'
  if (fill.fillAction === 'refill-same-type') return '補裝同種'
  return '換裝'
}

export function PlanApplicationPreview({
  draft,
  productionJarFills,
  checkedIngredientIds = new Set<string>(),
  onIngredientCheckedChange,
  onApply,
}: {
  draft: PlanApplicationTransactionDraft
  productionJarFills: readonly MultiTripProductionJarFill[]
  checkedIngredientIds?: ReadonlySet<string>
  onIngredientCheckedChange?: (ingredientId: string, checked: boolean) => void
  onApply: (draft: PlanApplicationTransactionDraft) => void
}) {
  const changes = draft.changes
  const terminalJuiceJars = draft.after.inventory.juiceJars.filter(
    (jar) => jar.servings > 0,
  )

  return (
    <section
      className="optimizer-result-section optimizer-transaction-preview"
      aria-label="套用規劃預覽"
    >
      <div className="section-title">
        <strong>套用規劃預覽</strong>
        <span>確認後才會寫入</span>
      </div>

      <p className="optimizer-transaction-note">
        以下是這份規劃的變更前 → 變更後。按下確認時會重新讀取目前 canonical
        basis；只要庫存、進度、滿意度、正式顧客、今日已供應或規劃器設定有任一項改變，
        就會拒絕提交。驗證通過後，庫存與今日已供應狀態會以單一持久狀態一次寫入。
      </p>

      <button
        type="button"
        className="optimizer-run-button"
        onClick={() => onApply(draft)}
      >
        確認套用這份規劃
      </button>

      <div className="optimizer-transaction-grid">
        <article className="optimizer-transaction-card">
          <div className="optimizer-transaction-card-heading">
            <strong>原料</strong>
            <span>{changes.ingredients.length} 種</span>
          </div>
          {changes.ingredients.length === 0 ? (
            <p>沒有原料庫存變更。</p>
          ) : (
            <div className="optimizer-transaction-list">
              {changes.ingredients.map((change) => (
                <div
                  className="optimizer-transaction-row"
                  key={change.ingredientId}
                >
                  <label className="optimizer-transaction-checkable-name">
                    <input
                      type="checkbox"
                      checked={checkedIngredientIds.has(change.ingredientId)}
                      onChange={(event) =>
                        onIngredientCheckedChange?.(
                          change.ingredientId,
                          event.currentTarget.checked,
                        )
                      }
                      aria-label={ingredientLabel(change.ingredientId) + ' 已備齊'}
                    />
                    <strong>{ingredientLabel(change.ingredientId)}</strong>
                  </label>
                  <span>
                    {change.beforeUnits} → {change.afterUnits} 單位
                  </span>
                  <small>
                    使用既有 {change.consumedFromInventory} 單位
                    {change.acquiredAndConsumedUnits > 0
                      ? ' · 另取得並於當日使用 ' +
                        change.acquiredAndConsumedUnits +
                        ' 單位'
                      : ''}
                  </small>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="optimizer-transaction-card">
          <div className="optimizer-transaction-card-heading">
            <strong>中間果汁</strong>
            <span>{changes.intermediateJuice.length} 種</span>
          </div>
          {changes.intermediateJuice.length === 0 ? (
            <p>沒有中間果汁庫存變更。</p>
          ) : (
            <div className="optimizer-transaction-list">
              {changes.intermediateJuice.map((change) => (
                <div className="optimizer-transaction-row" key={change.identity}>
                  <strong>{sequenceLabel([...change.ingredientIds])}</strong>
                  <span>{change.beforeUnits} → {change.afterUnits} 果汁單位</span>
                  <small>本次使用 {change.consumedUnits} 果汁單位</small>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="optimizer-transaction-card">
          <div className="optimizer-transaction-card-heading">
            <strong>水</strong>
            <span>
              {changes.water.beforeUnits} → {changes.water.afterUnits}
            </span>
          </div>
          <div className="optimizer-transaction-list">
            <div className="optimizer-transaction-row">
              <strong>庫存水量</strong>
              <span>
                {changes.water.beforeUnits} → {changes.water.afterUnits} 單位
              </span>
              <small>
                製作 {changes.water.productionUnitsRequired} · 洗杯{' '}
                {changes.water.cupWashUnitsRequired} · 使用既有{' '}
                {changes.water.consumedFromInventory}
                {changes.water.externalUnitsRequired > 0
                  ? ' · 另需取得 ' +
                    changes.water.externalUnitsRequired +
                    ' 單位'
                  : ''}
              </small>
            </div>
          </div>
        </article>

        <article className="optimizer-transaction-card">
          <div className="optimizer-transaction-card-heading">
            <strong>杯具</strong>
            <span>
              實體杯 {changes.cups.physicalBefore} →{' '}
              {changes.cups.physicalAfter}
            </span>
          </div>
          <div className="optimizer-transaction-list">
            <div className="optimizer-transaction-row">
              <strong>乾淨杯</strong>
              <span>
                {changes.cups.cleanBefore} → {changes.cups.cleanAfter}
              </span>
            </div>
            <div className="optimizer-transaction-row">
              <strong>用過的杯子</strong>
              <span>
                {changes.cups.usedBefore} → {changes.cups.usedAfter}
              </span>
              {changes.cups.droppedUsedCups > 0 && (
                <small>
                  本次規劃會掉落 {changes.cups.droppedUsedCups} 個用過的杯子。
                </small>
              )}
            </div>
          </div>
        </article>

        <article className="optimizer-transaction-card">
          <div className="optimizer-transaction-card-heading">
            <strong>今日供應顧客</strong>
            <span>
              {draft.before.suppliedCustomerIds.length} →{' '}
              {draft.after.suppliedCustomerIds.length} 人
            </span>
          </div>
          {changes.newlySuppliedCustomerIds.length === 0 ? (
            <p>沒有新增今日供應顧客。</p>
          ) : (
            <p>
              新增：
              {changes.newlySuppliedCustomerIds
                .map(customerLabel)
                .join('、')}
            </p>
          )}
        </article>
      </div>

      {changes.discardedJuice.length > 0 && (
        <article className="optimizer-transaction-card optimizer-transaction-jars">
          <div className="optimizer-transaction-card-heading">
            <strong>將倒掉的果汁</strong>
            <span>{changes.discardedJuice.length} 筆</span>
          </div>
          <div className="optimizer-transaction-list">
            {changes.discardedJuice.map((discarded) => (
              <div
                className="optimizer-transaction-row"
                key={discarded.physicalJarId}
              >
                <strong>果汁罐 {discarded.physicalJarId}</strong>
                <span>倒掉 {discarded.servings} 杯</span>
                <small>
                  {discarded.source === 'initial-contents'
                    ? '既有內容 · '
                    : `本次新製作殘餘 · 第 ${discarded.afterTripNumber} 趟後 · `}
                  {transactionRecipeLabel(
                    discarded.recipeId,
                    productionJarFills,
                  )}
                </small>
              </div>
            ))}
          </div>
          <p className="optimizer-transaction-note">
            只有在已明確允許倒掉果汁時才會出現；既有內容與本次新製作後無法保存的殘餘會分開標示，顧客需要的杯數不會被倒掉。
          </p>
        </article>
      )}

      <article className="optimizer-transaction-card optimizer-transaction-jars">
        <div className="optimizer-transaction-card-heading">
          <strong>實體果汁罐</strong>
          <span>
            {changes.juiceJars.length} 個內容變更 · 期末 {terminalJuiceJars.length} 個有內容
          </span>
        </div>

        {changes.juiceJars.length === 0 ? (
          <p>期末沒有果汁罐內容淨變更。</p>
        ) : (
          <div className="optimizer-transaction-list">
            {changes.juiceJars.map((change) => (
              <div
                className="optimizer-transaction-row"
                key={change.physicalJarId}
              >
                <strong>果汁罐 {change.physicalJarId}</strong>
                <span>{transactionJarChangeLabel(change)}</span>
                <small>
                  {transactionJarContentLabel(
                    change.before,
                    productionJarFills,
                  )}
                  {' → '}
                  {transactionJarContentLabel(
                    change.after,
                    productionJarFills,
                  )}
                </small>
              </div>
            ))}
          </div>
        )}

        <div className="optimizer-transaction-fill-events">
          <strong>期末果汁罐內容</strong>
          {terminalJuiceJars.length === 0 ? (
            <p>期末所有實體果汁罐皆為空罐。</p>
          ) : (
            terminalJuiceJars.map((jar) => (
              <p key={'terminal-' + jar.id}>
                果汁罐 {jar.id} ·{' '}
                {transactionJarContentLabel(jar, productionJarFills)}
              </p>
            ))
          )}
        </div>

        {productionJarFills.length > 0 && (
          <div className="optimizer-transaction-fill-events">
            <strong>本日成品裝罐事件</strong>
            {productionJarFills.map((fill, index) => (
              <p
                key={
                  fill.physicalJarId +
                  '-' +
                  fill.beforeTripNumber +
                  '-' +
                  index
                }
              >
                果汁罐 {fill.physicalJarId} ·{' '}
                {transactionFillActionLabel(fill)} ·{' '}
                {formatRecipeDisplayName(fill.recipeName)} ×
                {fill.servings} 杯 · 第 {fill.beforeTripNumber} 趟販售前
              </p>
            ))}
          </div>
        )}
      </article>
    </section>
  )
}

export interface DeliveryCustomerControlState {
  status: 'committed' | 'active' | 'unavailable'
  tripNumber: number | null
  activeTripNumber: number | null
  physicalJarId: string | null
}

export function deliveryCustomerControlState(
  plan: DeliveryExecutionPlan | null,
  cursor: DeliveryExecutionCursor | null,
  suppliedCustomerIds: readonly string[],
  customerId: string,
): DeliveryCustomerControlState {
  const committed = suppliedCustomerIds.includes(customerId)

  if (!plan || !cursor) {
    return {
      status: committed ? 'committed' : 'active',
      tripNumber: null,
      activeTripNumber: cursor?.nextTripNumber ?? null,
      physicalJarId: null,
    }
  }

  const trip = plan.trips.find((item) =>
    item.deliveries.some(
      (delivery) => delivery.customerId === customerId,
    ),
  )
  const delivery = trip?.deliveries.find(
    (item) => item.customerId === customerId,
  )

  if (!trip || !delivery) {
    return {
      status: 'unavailable',
      tripNumber: null,
      activeTripNumber: cursor.nextTripNumber,
      physicalJarId: null,
    }
  }

  return {
    status: committed ? 'committed' : 'active',
    tripNumber: trip.tripNumber,
    activeTripNumber: cursor.nextTripNumber,
    physicalJarId: delivery.physicalJarId,
  }
}

export function customerIdsInPlannedTripOrder(
  customerIds: readonly string[],
  plan: DeliveryExecutionPlan | null,
): string[] {
  const tripByCustomerId = new Map(
    (plan?.trips ?? []).flatMap((trip) =>
      trip.deliveries.map(
        (delivery) => [delivery.customerId, trip.tripNumber] as const,
      ),
    ),
  )

  return customerIds
    .map((customerId, originalIndex) => ({
      customerId,
      originalIndex,
      tripNumber:
        tripByCustomerId.get(customerId) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort(
      (left, right) =>
        left.tripNumber - right.tripNumber ||
        left.originalIndex - right.originalIndex,
    )
    .map(({ customerId }) => customerId)
}


export function recipePlansInPlannedTripOrder<
  T extends { customerIds: readonly string[] },
>(
  recipePlans: readonly T[],
  plan: DeliveryExecutionPlan | null,
): T[] {
  const tripByCustomerId = new Map(
    (plan?.trips ?? []).flatMap((trip) =>
      trip.deliveries.map(
        (delivery) => [delivery.customerId, trip.tripNumber] as const,
      ),
    ),
  )

  return recipePlans
    .map((recipePlan, originalIndex) => ({
      recipePlan,
      originalIndex,
      firstTripNumber: recipePlan.customerIds.reduce(
        (firstTripNumber, customerId) =>
          Math.min(
            firstTripNumber,
            tripByCustomerId.get(customerId) ?? Number.MAX_SAFE_INTEGER,
          ),
        Number.MAX_SAFE_INTEGER,
      ),
    }))
    .sort(
      (left, right) =>
        left.firstTripNumber - right.firstTripNumber ||
        left.originalIndex - right.originalIndex,
    )
    .map(({ recipePlan }) => recipePlan)
}
export function DeliveryCustomerCheckbox({
  customerId,
  plan,
  cursor,
  suppliedCustomerIds,
  disabled = false,
  showPlanningDetail = true,
  onChange,
}: {
  customerId: string
  plan: DeliveryExecutionPlan | null
  cursor: DeliveryExecutionCursor | null
  suppliedCustomerIds: readonly string[]
  disabled?: boolean
  showPlanningDetail?: boolean
  onChange: (customerId: string, supplied: boolean) => void
}) {
  const control = deliveryCustomerControlState(
    plan,
    cursor,
    suppliedCustomerIds,
    customerId,
  )
  const committed = control.status === 'committed'
  const canChange = control.status !== 'unavailable' && !disabled
  const regionLabel = customerRegionLabel(customerId)

  const detail =
    control.status === 'committed'
      ? '已記錄今日供應'
      : control.status === 'active'
        ? control.tripNumber !== null && control.physicalJarId !== null
          ? `規劃第 ${control.tripNumber} 趟 · 果汁罐 ${control.physicalJarId} · 可依實際送達順序勾選`
          : '可記錄今日已供應；目前沒有對應的物理交付事件'
        : '目前沒有對應的規劃顧客'

  return (
    <label
      className={
        committed
          ? 'optimizer-delivery-customer committed'
          : canChange
            ? 'optimizer-delivery-customer active'
            : 'optimizer-delivery-customer'
      }
    >
      <input
        type="checkbox"
        checked={committed}
        disabled={!canChange}
        onChange={(event) => {
          if (canChange) {
            onChange(customerId, event.target.checked)
          }
        }}
        aria-label={`${customerLabel(customerId)}交付完成`}
      />
      <span>
        <span className="optimizer-delivery-customer-heading">
          <strong>{customerLabel(customerId)}</strong>
          {regionLabel && (
            <span className="optimizer-customer-region-badge">
              {regionLabel}
            </span>
          )}
        </span>
        {showPlanningDetail && <small>{detail}</small>}
      </span>
    </label>
  )
}

export interface DeliveryRecipeGroupControlState {
  checked: boolean
  partial: boolean
  canCommit: boolean
  pendingCustomerIds: readonly string[]
}

export function deliveryRecipeGroupControlState(
  plan: DeliveryExecutionPlan | null,
  cursor: DeliveryExecutionCursor | null,
  suppliedCustomerIds: readonly string[],
  customerIds: readonly string[],
  disabled = false,
): DeliveryRecipeGroupControlState {
  const controls = customerIds.map((customerId) => ({
    customerId,
    control: deliveryCustomerControlState(
      plan,
      cursor,
      suppliedCustomerIds,
      customerId,
    ),
  }))
  const committedCount = controls.filter(
    ({ control }) => control.status === 'committed',
  ).length
  const pendingCustomerIds = controls
    .filter(({ control }) => control.status !== 'committed')
    .map(({ customerId }) => customerId)
  const checked =
    customerIds.length > 0 &&
    committedCount === customerIds.length
  const partial = committedCount > 0 && !checked
  const canCommit =
    !disabled &&
    pendingCustomerIds.length > 0 &&
    controls
      .filter(({ control }) => control.status !== 'committed')
      .every(({ control }) => control.status === 'active')

  return {
    checked,
    partial,
    canCommit,
    pendingCustomerIds,
  }
}

export function DeliveryRecipeGroupCheckbox({
  recipeName,
  customerIds,
  plan,
  cursor,
  suppliedCustomerIds,
  disabled = false,
  onChange,
}: {
  recipeName: string
  customerIds: readonly string[]
  plan: DeliveryExecutionPlan | null
  cursor: DeliveryExecutionCursor | null
  suppliedCustomerIds: readonly string[]
  disabled?: boolean
  onChange: (customerIds: readonly string[], supplied: boolean) => void
}) {
  const control = deliveryRecipeGroupControlState(
    plan,
    cursor,
    suppliedCustomerIds,
    customerIds,
    disabled,
  )
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = control.partial
    }
  }, [control.partial])

  return (
    <label
      className={
        control.checked
          ? 'optimizer-delivery-recipe-group committed'
          : control.partial
            ? 'optimizer-delivery-recipe-group partial'
            : control.canCommit
              ? 'optimizer-delivery-recipe-group active'
              : 'optimizer-delivery-recipe-group'
      }
      title={undefined}
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={control.checked}
        aria-checked={control.partial ? 'mixed' : control.checked}
        disabled={disabled || customerIds.length === 0}
        onChange={(event) => {
          if (event.target.checked) {
            if (control.canCommit) {
              onChange(control.pendingCustomerIds, true)
            }
          } else {
            onChange(customerIds, false)
          }
        }}
        aria-label={`${formatRecipeDisplayName(recipeName)}整組交付完成`}
      />
      <strong>{formatRecipeDisplayName(recipeName)}</strong>
    </label>
  )
}

export function DeliveryTripGroupCheckbox({
  tripNumber,
  customerIds,
  plan,
  cursor,
  suppliedCustomerIds,
  disabled = false,
  onChange,
}: {
  tripNumber: number
  customerIds: readonly string[]
  plan: DeliveryExecutionPlan | null
  cursor: DeliveryExecutionCursor | null
  suppliedCustomerIds: readonly string[]
  disabled?: boolean
  onChange: (customerIds: readonly string[], supplied: boolean) => void
}) {
  const control = deliveryRecipeGroupControlState(
    plan,
    cursor,
    suppliedCustomerIds,
    customerIds,
    disabled,
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const completedCount = customerIds.filter((customerId) =>
    suppliedCustomerIds.includes(customerId),
  ).length

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = control.partial
    }
  }, [control.partial])

  return (
    <label
      className={
        control.checked
          ? 'optimizer-delivery-trip-group committed'
          : control.partial
            ? 'optimizer-delivery-trip-group partial'
            : control.canCommit
              ? 'optimizer-delivery-trip-group active'
              : 'optimizer-delivery-trip-group'
      }
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={control.checked}
        aria-checked={control.partial ? 'mixed' : control.checked}
        disabled={disabled || customerIds.length === 0}
        onChange={(event) => {
          if (event.target.checked) {
            if (control.canCommit) {
              onChange(control.pendingCustomerIds, true)
            }
          } else {
            onChange(customerIds, false)
          }
        }}
        aria-label={`第 ${tripNumber} 趟全部交付完成`}
      />
      <span>
        <strong>第 {tripNumber} 趟</strong>
        <small>
          本趟完成 {completedCount} / {customerIds.length}
        </small>
      </span>
    </label>
  )
}

export function OptimizerSummaryMetrics({
  result,
  salesPlan,
}: {
  result: OptimizationResult
  salesPlan: Pick<
    MultiTripReplenishmentPlan,
    'jarTypeSwitches' | 'tripCount' | 'totalLeftoverServings'
  >
}) {
  return (
    <div className="optimizer-metrics" aria-label="最佳化摘要">
      <MetricCard
        label="原料總成本"
        value={optimizerMoney(result.totalIngredientCost)}
      />
      <MetricCard
        label="已知銷售總額"
        value={optimizerMoney(result.knownSalesRevenue)}
      />
      <MetricCard
        label="已知毛利"
        value={optimizerMoney(result.knownGrossProfit)}
      />
      <MetricCard
        label="正式販售 / 潛在試喝"
        value={result.formalSalesCount + ' / ' + result.potentialTrialCount}
      />
      <MetricCard
        label="最終果汁種類"
        value={String(result.recipePlans.length)}
      />
      <MetricCard
        label="最佳化機器操作（gross）"
        value={result.machineOperations.total + ' 次'}
      />
      <MetricCard
        label="果汁罐換裝（實體排程）"
        value={salesPlan.jarTypeSwitches + ' 次'}
      />
      <MetricCard
        label="販售趟數（目前策略）"
        value={salesPlan.tripCount + ' 趟'}
      />
      <MetricCard
        label="已分配 / 產出"
        value={result.assignedServings + ' / ' + result.producedServings}
      />
      <MetricCard
        label="剩餘杯"
        value={String(salesPlan.totalLeftoverServings)}
      />
    </div>
  )
}

function OptimizerResultPanel({
  result,
  currentProgress,
  activeWorkshopRegionId,
  preparationShortfall,
  productionLogistics,
  priorities,
  salesTripPlans,
  transactionDraft,
  transactionDraftInvalidatedByPartialDelivery,
  deliveryExecutionPlan,
  deliveryCursor,
  suppliedCustomerIds,
  deliveryUiState,
  onApplyTransaction,
  onCommitDelivery,
  onCommitDeliveryGroup,
}: {
  result: OptimizationResult
  currentProgress: ProgressMilestoneId
  activeWorkshopRegionId: VillageId
  preparationShortfall: PreparationShortfall
  productionLogistics: ProductionLogisticsPlan
  priorities: OptimizationCriterion[]
  salesTripPlans: SalesTripPlans
  transactionDraft: PlanApplicationTransactionDraft | null
  transactionDraftInvalidatedByPartialDelivery: boolean
  deliveryExecutionPlan: DeliveryExecutionPlan | null
  deliveryCursor: DeliveryExecutionCursor | null
  suppliedCustomerIds: readonly string[]
  deliveryUiState: DeliveryUiState
  onApplyTransaction: (draft: PlanApplicationTransactionDraft) => void
  onCommitDelivery: (customerId: string, supplied: boolean) => void
  onCommitDeliveryGroup: (customerIds: readonly string[], supplied: boolean) => void
}) {
  const selectedSalesTripPlan = salesTripPlans.selected
  const alternateSalesTripPlan = salesTripPlans.alternate
  const [showRemainingSalesPlan, setShowRemainingSalesPlan] = useState(false)
  const remainingSalesTripPlan = useMemo(() => {
    const routing = productionRegionRoutingInput(
      currentProgress,
      activeWorkshopRegionId,
    )
    const assignedCustomerIds = result.recipePlans.flatMap(
      (plan) => plan.customerIds,
    )
    return buildRemainingSalesTripPlan({
      recipeAssignments: result.recipePlans.map((plan) => ({
        recipeId: plan.recipeId,
        recipeName: plan.recipeName,
        customerIds: plan.customerIds,
      })),
      suppliedCustomerIds,
      originalTripServingCounts: selectedSalesTripPlan.trips.map(
        (trip) => trip.totalServings,
      ),
      activeWorkshop: routing.activeWorkshop,
      topology: routing.topology,
      customerRegionById:
        productionCustomerRegionById(assignedCustomerIds),
    })
  }, [
    activeWorkshopRegionId,
    currentProgress,
    result.recipePlans,
    selectedSalesTripPlan.trips,
    suppliedCustomerIds,
  ])
  const productionPlan = productionLogistics.productionPlan
  const productionChecklistFingerprint = useMemo(
    () => productionPlanFingerprint(productionPlan),
    [productionPlan],
  )
  const [
    completedProductionOperationIds,
    setCompletedProductionOperationIds,
  ] = useState<Set<string>>(
    () =>
      new Set(
        readProductionChecklist(
          window.localStorage,
          productionPlan,
        ).completedOperationIds,
      ),
  )

  useEffect(() => {
    const stored = readProductionChecklist(
      window.localStorage,
      productionPlan,
    )
    setCompletedProductionOperationIds(
      new Set(stored.completedOperationIds),
    )
  }, [productionChecklistFingerprint, productionPlan])

  function setProductionOperationCompleted(
    operationId: string,
    completed: boolean,
  ) {
    setCompletedProductionOperationIds((current) => {
      const next = new Set(current)
      if (completed) {
        next.add(operationId)
      } else {
        next.delete(operationId)
      }
      writeProductionChecklist(
        window.localStorage,
        productionPlan,
        next,
      )
      return next
    })
  }

  function resetProductionChecklist() {
    writeProductionChecklist(
      window.localStorage,
      productionPlan,
      [],
    )
    setCompletedProductionOperationIds(new Set())
  }

  const purchaseItemByIngredientId = new Map(
    result.shoppingList.map((item) => [item.ingredientId, item]),
  )
  const ingredientChecklistItems = transactionDraft
    ? transactionDraft.changes.ingredients.map((change) => ({
        ingredientId: change.ingredientId,
        requiredUnits:
          change.consumedFromInventory + change.acquiredAndConsumedUnits,
        inventoryUnitsUsed: change.consumedFromInventory,
        purchaseUnits: change.acquiredAndConsumedUnits,
      }))
    : []
  const ingredientChecklistPlanFingerprint =
    ingredientChecklistFingerprint(ingredientChecklistItems)
  const [checkedIngredientIds, setCheckedIngredientIds] = useState<Set<string>>(
    () =>
      new Set(
        readIngredientChecklist(
          window.localStorage,
          ingredientChecklistItems,
        ),
      ),
  )

  useEffect(() => {
    setCheckedIngredientIds(
      new Set(
        readIngredientChecklist(
          window.localStorage,
          ingredientChecklistItems,
        ),
      ),
    )
  }, [ingredientChecklistPlanFingerprint])

  function setIngredientChecked(
    ingredientId: string,
    checked: boolean,
  ) {
    setCheckedIngredientIds((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(ingredientId)
      } else {
        next.delete(ingredientId)
      }
      writeIngredientChecklist(
        window.localStorage,
        ingredientChecklistItems,
        next,
      )
      return next
    })
  }
  const productionStepsByEquipment =
    productionLogistics.productionPlan.steps.reduce<
      Record<string, ProductionLogisticsPlan['productionPlan']['steps']>
    >((groups, step) => {
    ;(groups[step.equipment] ??= []).push(step)
    return groups
  }, {})

  return (
    <div className="optimizer-results">
      <OptimizerSummaryMetrics
        result={result}
        salesPlan={selectedSalesTripPlan}
      />

      <div className="optimizer-result-note">
        <strong>
          最佳化順序：{priorities.map(criterionLabel).join(' → ')}
        </strong>
        <span>
          最佳化 gross 操作：榨汁 {result.machineOperations.juicing} 次 · 調味{' '}
          {result.machineOperations.seasoning} 次 · 調和{' '}
          {result.machineOperations.blending} 次 · 成品台{' '}
          {result.machineOperations.finalizing} 次
        </span>
        <span>
          庫存抵扣後實際需製作：
          {productionLogistics.productionPlan.machineOperations.total} 次操作
          （榨汁 {productionLogistics.productionPlan.machineOperations.juicing} · 調味{' '}
          {productionLogistics.productionPlan.machineOperations.seasoning} · 調和{' '}
          {productionLogistics.productionPlan.machineOperations.blending} · 成品台{' '}
          {productionLogistics.productionPlan.machineOperations.finalizing}）
        </span>
        <span>
          本日可用實體果汁罐 {result.availableJuiceJarCount} 個；有果汁罐架時可跨趟換罐，同罐改裝成另一種果汁才計入換裝。
        </span>
        <span>
          販售摘要採「{tripPolicyLabel(selectedSalesTripPlan)}」；杯具依實際持有量與 clean → used stack transition 計算，果汁成品台接收罐也依這份販售排程的 physical jar 時序安排；替代 policy 可在販售排程展開比較。
        </span>
        {(result.potentialTrialCount > 0 ||
          result.unknownFormalSalePriceCount > 0) && (
          <small>
            {result.potentialTrialCount > 0
              ? '潛在試喝 ' +
                result.potentialTrialCount +
                ' 杯的收入未確認，不計入已知銷售總額。'
              : ''}
            {result.unknownFormalSalePriceCount > 0
              ? ' 正式販售另有 ' +
                result.unknownFormalSalePriceCount +
                ' 杯售價未知。'
              : ''}
          </small>
        )}
      </div>

      {transactionDraft ? (
        <PlanApplicationPreview
          draft={transactionDraft}
          productionJarFills={selectedSalesTripPlan.productionJarFills}
          checkedIngredientIds={checkedIngredientIds}
          onIngredientCheckedChange={setIngredientChecked}
          onApply={onApplyTransaction}
        />
      ) : (
        <section
          className="optimizer-result-section optimizer-transaction-preview"
          aria-label="套用規劃預覽"
        >
          <div className="section-title">
            <strong>套用規劃預覽</strong>
            <span>
              {transactionDraftInvalidatedByPartialDelivery
                ? '已有部分交付'
                : '目前無法建立'}
            </span>
          </div>
          <p className="optimizer-transaction-warning">
            {transactionDraftInvalidatedByPartialDelivery
              ? '今日已供應狀態出現無法與這份規劃安全對齊的變更，因此原本的整份套用預覽已失效。只有「原本未供應、且屬於這份規劃的顧客被勾為已供應」能保留套用預覽；其他供應狀態變更請重新產生完整規劃。'
              : '目前製作物流不可行，因此不建立交易草稿，也不會修改庫存。請先處理下方製作物流警告後重新產生規劃。'}
          </p>
        </section>
      )}

      <section className="optimizer-result-section">
        <div className="section-title">
          <strong>其他製作需求</strong>
          <span>原料已列於上方交易預覽；此處只保留水與杯具</span>
        </div>

        <div className="optimizer-batch-list">
          <article className="optimizer-batch-card">
            <div>
              <strong>水</strong>
              <span>免費取得 · 10 / slot</span>
            </div>
            <p>
              需求 {preparationShortfall.productionWaterUnitsRequired} · 現有{' '}
              {preparationShortfall.waterUnitsAvailable} · 使用{' '}
              {preparationShortfall.waterUnitsUsed} · 需取得{' '}
              {preparationShortfall.waterUnitsToFetch}
            </p>
            <small>
              本次缺水若一次搬回，需要{' '}
              {optimizerWaterFetchSlots(
                preparationShortfall.waterUnitsToFetch,
              )}{' '}
              個背包 slot；實際取水／回架／再製作的多趟順序留待 production logistics。
            </small>
          </article>

          <article className="optimizer-batch-card">
            <div>
              <strong>杯具</strong>
              <span>實際持有杯數限制販售量</span>
            </div>
            <p>
              全天供應 {preparationShortfall.cleanCupUses} 杯 · 起始 clean{' '}
              {selectedSalesTripPlan.initialCleanCups} · used{' '}
              {selectedSalesTripPlan.initialUsedCups} · 實體杯共{' '}
              {selectedSalesTripPlan.initialPhysicalCupCount}
            </p>
            <small>
              目前策略需清洗 {selectedSalesTripPlan.totalCupWashWaterUnits} 個杯子（等量用水）；
              結束後持有 {selectedSalesTripPlan.finalPhysicalCupCount} 個杯子
              {selectedSalesTripPlan.droppedUsedCups > 0
                ? '，其中 ' + selectedSalesTripPlan.droppedUsedCups + ' 個 used cup 因背包滿而掉落。'
                : '，沒有杯具掉落。'}
            </small>
          </article>
        </div>

        <small className="optimizer-boundary-note">
          「需購買」只指有購買來源的原料；水免費，因此列為「需取得」而不是從結果中省略。
        </small>
      </section>

      <section className="optimizer-result-section">
        <div className="section-title">
          <strong>製作步驟</strong>
          <span>
            庫存抵扣後 {productionLogistics.productionPlan.machineOperations.total} 次操作
          </span>
        </div>

        {productionLogistics.productionPlan.machineOperations.total > 0 && (
          <div className="optimizer-production-checklist-toolbar">
            <span>
              已完成 {completedProductionOperationIds.size} /{' '}
              {productionLogistics.productionPlan.machineOperations.total} 批
              · 只記錄玩家進度，不會修改庫存或規劃結果。
            </span>
            <button
              type="button"
              disabled={completedProductionOperationIds.size === 0}
              onClick={resetProductionChecklist}
            >
              全部取消／重新開始
            </button>
          </div>
        )}

        {Object.keys(productionStepsByEquipment).length === 0 ? (
          <p className="empty-tool-state">目前沒有需要新增製作的步驟。</p>
        ) : (
          Object.entries(productionStepsByEquipment).map(
            ([equipment, steps]) => (
              <section
                className="optimizer-machine-group"
                key={equipment}
                aria-label={equipment + ' 製作步驟'}
              >
                <header className="optimizer-machine-header">
                  <div>
                    <span>機器</span>
                    <strong>{equipment}</strong>
                    {equipment === '調味器' && (
                      <SeasoningStageMaterialSummary
                        ingredientUnits={
                          productionLogistics.productionPlan
                            .seasoningIngredientUnits ?? {}
                        }
                        baseJuiceUnits={
                          productionLogistics.productionPlan
                            .seasoningBaseJuiceUnits ?? {}
                        }
                      />
                    )}
                  </div>
                  <span>
                    {steps.reduce(
                      (sum, step) => sum + step.operationCount,
                      0,
                    )}{' '}
                    批 · 每批 1～5 份
                  </span>
                </header>

                <div className="optimizer-machine-steps">
                  {steps.map((step) => {
                    const readyForFinalizingUnits =
                      productionLogistics.productionPlan
                        .readyForFinalizingUnitsByStepKey?.[step.key] ?? 0

                    return (
                      <article
                        className="optimizer-production-step-card"
                        key={step.key}
                      >
                        <div className="optimizer-production-step-heading">
                          <strong>{productionStepLabel(step)}</strong>
                          <span>
                            總量 {step.quantity} 份 · {step.operationCount} 批
                          </span>
                        </div>
                        <ProductionStepFinalJuiceNote
                          stepKind={step.kind}
                          readyForFinalizingUnits={readyForFinalizingUnits}
                        />
                        {step.kind === 'seasoning' &&
                          productionLogistics.productionPlan
                            .seasoningStageReuseUnitsByStepKey && (
                            <SeasoningStepStageUsageNote
                              quantity={step.quantity}
                              stillNeededUnits={
                                productionLogistics.productionPlan
                                  .seasoningStageReuseUnitsByStepKey[
                                    step.key
                                  ] ?? 0
                              }
                            />
                          )}
                        <div className="optimizer-operation-batches">
                          {optimizerOperationQuantities(step.quantity).map(
                            (quantity, index) => {
                              const operationId = productionOperationId(
                                step.key,
                                index,
                              )
                              return (
                                <MachineBatchFlow
                                  key={operationId}
                                  step={step}
                                  quantity={quantity}
                                  batchIndex={index}
                                  completed={completedProductionOperationIds.has(
                                    operationId,
                                  )}
                                  onCompletedChange={(completed) =>
                                    setProductionOperationCompleted(
                                      operationId,
                                      completed,
                                    )
                                  }
                                />
                              )
                            },
                          )}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ),
          )
        )}

        <small className="optimizer-boundary-note">
          ▸ 表示配方內部原料順序；→ 只表示實際加工或狀態轉換。此區顯示庫存抵扣後真正需要執行的製作量；每個膠囊代表一個機器 slot 內的原料、果汁、水或輸出。「可先放架上」只表示調味器階段不再使用，後續果汁調和器或果汁成品台仍可能需要。勾選狀態綁定目前 net production plan；重新產生相同規劃可恢復，規劃內容不同時不會套用舊進度。
        </small>

        <div className="optimizer-logistics-summary">
          <strong>
            製作物流：{productionLogistics.feasible ? '可行' : '目前不可行'}
          </strong>
          <span>
            原料取得動作 {productionLogistics.ingredientAcquisitionActions} · 取水{' '}
            {productionLogistics.waterFetchTrips} 趟 · 物流動作{' '}
            {productionLogistics.actions.length}
          </span>
          <span>
            初始一般架 {productionLogistics.initialSnapshot.shelfSlotsUsed}/
            {productionLogistics.initialSnapshot.shelfSlotsAvailable} 格 · 背包一般物品{' '}
            {productionLogistics.initialSnapshot.backpackSlotsUsed}/
            {productionLogistics.initialSnapshot.backpackSlotsAvailable} 格 · 強制隨身／固定使用的果汁罐格{' '}
            {productionLogistics.initialSnapshot.carriedJarSlots} 格 · 可接手成品的實體罐{' '}
            {productionLogistics.initialSnapshot.outputJarReceiverSlots} 個
            （背包 {productionLogistics.initialSnapshot.carriedOutputJarSlots} · 果汁罐架{' '}
            {productionLogistics.initialSnapshot.rackOutputJarSlots}）
          </span>
        </div>

        {!productionLogistics.feasible && (
          <div className="optimizer-logistics-warning" role="status">
            {productionLogistics.issues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        )}

        {productionLogistics.actions.length > 0 && (
          <details className="optimizer-logistics-details">
            <summary>
              展開製作物流流程（{productionLogistics.actions.length} 個動作）
            </summary>
            <div className="optimizer-batch-list">
              {productionLogistics.actions.map((action) => (
                <article
                  className="optimizer-batch-card"
                  key={action.index + '-' + action.kind}
                >
                  <div>
                    <strong>
                      {action.index}. {action.label}
                    </strong>
                    <span>
                      {productionLogisticsActionKindLabel(action.kind)}
                    </span>
                  </div>
                  <p>
                    一般架 {action.snapshot.shelfSlotsUsed}/
                    {action.snapshot.shelfSlotsAvailable} · 背包一般物品{' '}
                    {action.snapshot.backpackSlotsUsed}/
                    {action.snapshot.backpackSlotsAvailable} · 果汁罐格{' '}
                    {action.snapshot.carriedJarSlots}
                    {action.snapshot.machineSlotsAvailable > 0
                      ? ' · 機器 ' +
                        action.snapshot.machineSlotsUsed +
                        '/' +
                        action.snapshot.machineSlotsAvailable
                      : ''}
                    {action.outputJarReceiver
                      ? ' · 成品接收 → ' +
                        (action.outputJarReceiver === 'carried-jar'
                          ? '隨身實體果汁罐'
                          : '果汁罐架上的實體果汁罐') +
                        (action.outputPhysicalJarId
                          ? ' ' + action.outputPhysicalJarId
                          : '') +
                        (action.beforeSalesTripNumber
                          ? ' · 第 ' +
                            action.beforeSalesTripNumber +
                            ' 趟前可裝入'
                          : '')
                      : ''}
                  </p>
                </article>
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="optimizer-result-section">
        <div className="section-title">
          <strong>果汁分配</strong>
          <span>
            {result.recipePlans.length} 種 ·{' '}
            {
              result.recipePlans
                .flatMap((plan) => plan.customerIds)
                .filter(
                  (customerId) =>
                    deliveryCustomerControlState(
                      deliveryExecutionPlan,
                      deliveryCursor,
                      suppliedCustomerIds,
                      customerId,
                    ).status === 'committed',
                ).length
            }
            {' / '}
            {result.recipePlans.reduce(
              (sum, plan) => sum + plan.customerIds.length,
              0,
            )}
            {' 人已交付'}
          </span>
        </div>

        <div className="optimizer-delivery-toolbar">
          <span>
            勾選個別顧客或配方標題，代表對應顧客已實際收到果汁；可依實際送達順序勾選，不受規劃趟次限制。勾選會更新「今日已供應」，但不會假裝尚未發生的前置趟次、裝瓶或杯具操作已完成。若只需要調整接下來的販售行程，可使用下方「剩餘販售重排」；若要重算製作或庫存，請先確認目前狀態後重新產生完整規劃。
            取消勾選只修正「今日已供應」紀錄，不會回復或修改任何庫存、杯具、果汁罐或製作狀態。
          </span>
        </div>

        {deliveryUiState.status === 'error' && (
          <p className="optimizer-transaction-warning" role="alert">
            交付沒有寫入：{deliveryUiState.message}
          </p>
        )}

        {result.recipePlans.length === 0 ? (
          <p className="empty-tool-state">本次沒有可製作的果汁。</p>
        ) : (
          <div className="optimizer-batch-list">
            {recipePlansInPlannedTripOrder(
              result.recipePlans,
              deliveryExecutionPlan,
            ).map((plan) => (
              <article className="optimizer-batch-card" key={plan.recipeId}>
                <div className="optimizer-delivery-recipe-heading">
                  <DeliveryRecipeGroupCheckbox
                    recipeName={plan.recipeName}
                    customerIds={plan.customerIds}
                    plan={deliveryExecutionPlan}
                    cursor={deliveryCursor}
                    suppliedCustomerIds={suppliedCustomerIds}
                    disabled={deliveryUiState.status === 'stale'}
                    onChange={onCommitDeliveryGroup}
                  />
                  <span>
                    配方基準原料成本：{optimizerMoney(plan.totalIngredientCost)}
                  </span>
                </div>
                <div className="optimizer-delivery-customer-list">
                  {customerIdsInPlannedTripOrder(
                    plan.customerIds,
                    deliveryExecutionPlan,
                  ).map(
                    (customerId) => (
                      <DeliveryCustomerCheckbox
                        key={customerId}
                        customerId={customerId}
                        plan={deliveryExecutionPlan}
                        cursor={deliveryCursor}
                        suppliedCustomerIds={suppliedCustomerIds}
                        disabled={deliveryUiState.status === 'stale'}
                        onChange={onCommitDelivery}
                      />
                    ),
                  )}
                </div>
                <p>
                  {recipePreparationSourceSummary(
                    plan,
                    preparationShortfall,
                  )}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="optimizer-result-section">
        <div className="section-title">
          <strong>販售排程</strong>
          <span>目前策略：{tripPolicyLabel(selectedSalesTripPlan)}</span>
        </div>

        <SalesTripPlanBlock
          plan={selectedSalesTripPlan}
          regionPlan={salesTripPlans.selectedRegion}
          deliveryControls={{
            plan: deliveryExecutionPlan,
            cursor: deliveryCursor,
            suppliedCustomerIds,
            disabled: deliveryUiState.status === 'stale',
            onChangeCustomer: onCommitDelivery,
            onChangeGroup: onCommitDeliveryGroup,
          }}
        />

        <details className="optimizer-policy-comparison">
          <summary>
            比較替代策略：{usedCupPolicyLabel(salesTripPlans.alternatePolicy)}
            {alternateSalesTripPlan
              ? '（' + alternateSalesTripPlan.tripCount + ' 趟）'
              : '（目前不可行）'}
          </summary>
          {alternateSalesTripPlan && salesTripPlans.alternateRegion ? (
            <SalesTripPlanBlock
              plan={alternateSalesTripPlan}
              regionPlan={salesTripPlans.alternateRegion}
            />
          ) : (
            <p className="optimizer-policy-unavailable">
              {salesTripPlans.alternateError ??
                '替代杯具策略目前無法產生可行排程。'}
            </p>
          )}
        </details>

        <small className="optimizer-boundary-note">
          兩種 policy 都使用實際持有杯數與逐杯 clean → used stack transition 驗證可行性；回工作間清洗會計入杯數與用水，掉落只代表 NPC 回傳時背包無空位。區域層只比較已確認的 Region edge footprint；不推導村內顧客順序、住處導航或到達時間。
        </small>
      </section>

      <section className="optimizer-result-section">
        <div className="section-title">
          <strong>剩餘販售重排</strong>
          <span>
            已送 {remainingSalesTripPlan.suppliedCustomerCount} /{' '}
            {remainingSalesTripPlan.totalCustomerCount} 人 · 尚待{' '}
            {remainingSalesTripPlan.remainingCustomerCount} 人
          </span>
        </div>

        <p className="optimizer-boundary-note">
          只沿用這份完整規劃已固定的顧客 → 配方分配，排除「今日已供應」後重新安排 Region／趟次；不重新選配方，也不重算製作、庫存、果汁罐或杯具。
        </p>

        {remainingSalesTripPlan.recipes.length > 0 && (
          <div
            className="optimizer-sales-region-demand"
            aria-label="剩餘販售需求"
          >
            {remainingSalesTripPlan.recipes.map((recipe) => (
              <span key={'remaining-recipe-' + recipe.recipeId}>
                <strong>
                  {formatRecipeDisplayName(recipe.recipeName)}
                </strong>
                {recipe.servings} 杯
              </span>
            ))}
          </div>
        )}

        {remainingSalesTripPlan.remainingCustomerCount === 0 ? (
          <p className="optimizer-result-note">
            這份規劃中的顧客都已記錄為今日已供應。
          </p>
        ) : remainingSalesTripPlan.suppliedCustomerCount === 0 ? (
          <p className="optimizer-boundary-note">
            尚未有已送顧客；目前直接依上方完整販售排程執行即可。
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                setShowRemainingSalesPlan((current) => !current)
              }
            >
              {showRemainingSalesPlan
                ? '收起剩餘販售行程'
                : '依未送顧客重排行程'}
            </button>
            {showRemainingSalesPlan && (
              <>
                <small className="optimizer-boundary-note">
                  沿用完整規劃的單趟服務規模：最多{' '}
                  {remainingSalesTripPlan.maxCustomerServicesPerTrip} 人。這只是剩餘行程的抽象分組上限，不代表目前實體果汁罐或杯具仍能承載相同數量。
                </small>
                <RemainingSalesTripPlanBlock
                  plan={remainingSalesTripPlan}
                  deliveryControls={{
                    plan: deliveryExecutionPlan,
                    cursor: deliveryCursor,
                    suppliedCustomerIds,
                    disabled: deliveryUiState.status === 'stale',
                    onChangeCustomer: onCommitDelivery,
                    onChangeGroup: onCommitDeliveryGroup,
                  }}
                />
              </>
            )}
          </>
        )}
      </section>

      {result.unresolvedCustomers.length > 0 && (
        <section className="optimizer-unresolved">
          <strong>
            目前沒有可靠 full match：{result.unresolvedCustomers.length} 人
          </strong>
          <p>{result.unresolvedCustomers.map(customerLabel).join('、')}</p>
        </section>
      )}
    </div>
  )
}

function regionDisplayName(regionId: string): string {
  return villageNames[regionId as VillageId] ?? regionId
}

interface SalesTripDeliveryControls {
  plan: DeliveryExecutionPlan | null
  cursor: DeliveryExecutionCursor | null
  suppliedCustomerIds: readonly string[]
  disabled?: boolean
  onChangeCustomer: (customerId: string, supplied: boolean) => void
  onChangeGroup: (
    customerIds: readonly string[],
    supplied: boolean,
  ) => void
}

function SalesTripCustomerRow({
  customerId,
}: {
  customerId: string
}) {
  const regionLabel = customerRegionLabel(customerId)

  return (
    <div className="optimizer-sales-customer-readonly">
      <strong>{customerLabel(customerId)}</strong>
      {regionLabel && (
        <span className="optimizer-customer-region-badge">
          {regionLabel}
        </span>
      )}
    </div>
  )
}

export function SalesTripPlanBlock({
  plan,
  regionPlan,
  deliveryControls,
}: {
  plan: MultiTripReplenishmentPlan
  regionPlan?: RegionPhysicalSalesPlan
  deliveryControls?: SalesTripDeliveryControls
}) {
  const totalServings = plan.trips.reduce(
    (sum, trip) => sum + trip.totalServings,
    0,
  )

  return (
    <div className="optimizer-batch-list optimizer-sales-plan">
      <article className="optimizer-batch-card optimizer-sales-overview">
        <header className="optimizer-sales-overview-header">
          <div>
            <strong>{tripPolicyLabel(plan)}</strong>
            <span>
              {plan.tripCount} 趟 · {totalServings} 杯 · 單趟最多隨身{' '}
              {plan.maxJuiceJarSlotsCarried} 罐
            </span>
          </div>
          <div className="optimizer-sales-overview-stats">
            {regionPlan && (
              <span>
                <b>工作間</b>
                {regionDisplayName(regionPlan.activeWorkshop.regionId)}
              </span>
            )}
            <span>
              <b>換裝</b>
              {plan.jarTypeSwitches} 次
            </span>
            <span>
              <b>清洗</b>
              {plan.totalCupWashWaterUnits} 杯
            </span>
            <span>
              <b>期末剩餘</b>
              {plan.totalLeftoverServings} 杯
            </span>
          </div>
        </header>

        {deliveryControls && (
          <p className="optimizer-sales-checklist-note">
            本區勾選與上方「果汁分配」同步，共用「今日已供應」狀態；手動勾選不會修改庫存、杯具、果汁罐或製作狀態。
          </p>
        )}

        {regionPlan && regionPlan.requiredByRegion.length > 0 && (
          <div
            className="optimizer-sales-region-demand"
            aria-label="各地區販售需求"
          >
            {regionPlan.requiredByRegion.map((required) => (
              <span key={'region-demand-' + required.regionId}>
                <strong>{regionDisplayName(required.regionId)}</strong>
                {required.totalServings} 杯
              </span>
            ))}
          </div>
        )}

        <details className="optimizer-sales-detail">
          <summary>展開今日規劃細節</summary>
          <div className="optimizer-sales-detail-body">
            <p>
              販售排程使用 {plan.physicalJarsUsed} /{' '}
              {plan.carriedJuiceJarCount} 個實體果汁罐；單趟最多使用{' '}
              {plan.maxJuiceJarSlotsCarried} 個果汁罐格。
            </p>
            {regionPlan && (
              <>
                <p>
                  區域路線成本 {regionPlan.routeCost} · 地區分散服務{' '}
                  {regionPlan.serviceFragmentation} 次
                </p>
                {regionPlan.requiredByRegion.map((required) => (
                  <p key={'region-demand-detail-' + required.regionId}>
                    {regionDisplayName(required.regionId)}：需求{' '}
                    {required.totalServings} 杯 ·{' '}
                    {required.recipes
                      .map(
                        (recipe) =>
                          formatRecipeDisplayName(recipe.recipeName) +
                          ' ' +
                          recipe.servings +
                          ' 杯',
                      )
                      .join('、')}
                  </p>
                ))}
              </>
            )}
            <p>
              本日可用實體罐：{' '}
              {plan.carriedJuiceJars
                .map((jar) => {
                  const initial =
                    jar.initialRecipeId && jar.initialServings > 0
                      ? (recipeNameById.get(jar.initialRecipeId) ??
                          jar.initialRecipeId) +
                        ' ' +
                        jar.initialServings +
                        ' 杯'
                      : '空罐'
                  return (
                    jar.physicalJarId +
                    '（' +
                    initial +
                    '）'
                  )
                })
                .join('、')}
            </p>
            <p>
              杯具：起始 clean {plan.initialCleanCups} / used{' '}
              {plan.initialUsedCups} · 清洗 {plan.totalCupWashWaterUnits}{' '}
              次／用水 {plan.totalCupWashWaterUnits} · 結束實體杯{' '}
              {plan.finalPhysicalCupCount}
              {plan.droppedUsedCups > 0
                ? ' · 掉落 ' + plan.droppedUsedCups
                : ''}
            </p>
            {plan.leftoverJarContents.map((leftover) => {
              const carriedOnLaterTrip = plan.trips.some(
                (trip) =>
                  trip.tripNumber > leftover.tripNumber &&
                  trip.carriedPhysicalJarIds.includes(
                    leftover.physicalJarId,
                  ),
              )
              return (
                <p
                  key={
                    'terminal-leftover-' +
                    leftover.physicalJarId +
                    '-' +
                    leftover.recipeId
                  }
                >
                  期末果汁罐：{leftover.physicalJarId} ·{' '}
                  {formatRecipeDisplayName(leftover.recipeName)} ·{' '}
                  {leftover.servings} 杯 · 第 {leftover.tripNumber} 趟後
                  {carriedOnLaterTrip ? '仍隨身保留' : '留在家中'}
                </p>
              )
            })}
            <small>
              {tripPolicyNote(plan)}
              {plan.totalLeftoverServings > 0
                ? ' 剩餘成品只會留在該 recipe 最後販售的同一 persistent physical jar；目前仍不寫回 inventory，跨日 commit 留待 Apply Plan。'
                : ''}
              {' '}所有持有果汁罐的既有內容都會納入今日販售來源；有果汁罐架時可在趟次之間整罐上架／換罐，未被今日需求喝空的既有內容不會為了減少換裝而自動丟棄。
            </small>
          </div>
        </details>
      </article>

      {plan.trips.map((trip) => {
        const regionTrip = regionPlan?.trips.find(
          (item) => item.tripNumber === trip.tripNumber,
        )
        const fillsBeforeTrip = plan.productionJarFills.filter(
          (fill) => fill.beforeTripNumber === trip.tripNumber,
        )
        const tripCustomerIds = trip.juiceJars.flatMap(
          (load) => load.customerIds,
        )

        return (
          <article
            className="optimizer-batch-card optimizer-sales-trip-card"
            key={plan.policy + '-' + trip.tripNumber}
          >
            <header className="optimizer-sales-trip-header">
              <div>
                {deliveryControls ? (
                  <DeliveryTripGroupCheckbox
                    tripNumber={trip.tripNumber}
                    customerIds={tripCustomerIds}
                    plan={deliveryControls.plan}
                    cursor={deliveryControls.cursor}
                    suppliedCustomerIds={
                      deliveryControls.suppliedCustomerIds
                    }
                    disabled={deliveryControls.disabled}
                    onChange={deliveryControls.onChangeGroup}
                  />
                ) : (
                  <strong>第 {trip.tripNumber} 趟</strong>
                )}
                <span>
                  {trip.totalServings} 杯 · 販售用{' '}
                  {trip.juiceJars.length} 罐 · 實際隨身{' '}
                  {trip.carriedPhysicalJarIds.length} 罐
                </span>
              </div>

              {regionTrip && (
                <div
                  className="optimizer-sales-region-chips"
                  aria-label={'第 ' + trip.tripNumber + ' 趟地區'}
                >
                  {regionTrip.primaryRegionIds.map((regionId) => (
                    <span
                      className="optimizer-sales-region-chip primary"
                      key={'primary-' + regionId}
                    >
                      主要 · {regionDisplayName(regionId)}
                    </span>
                  ))}
                  {regionTrip.sideRegionIds.map((regionId) => (
                    <span
                      className="optimizer-sales-region-chip side"
                      key={'side-' + regionId}
                    >
                      順帶 · {regionDisplayName(regionId)}
                    </span>
                  ))}
                  {regionTrip.transitRegionIds.map((regionId) => (
                    <span
                      className="optimizer-sales-region-chip transit"
                      key={'transit-' + regionId}
                    >
                      途經 · {regionDisplayName(regionId)}
                    </span>
                  ))}
                </div>
              )}
            </header>

            <section className="optimizer-sales-trip-section">
              <h4>出發前</h4>
              <div className="optimizer-sales-action-list">
                <p>
                  {trip.cupsWashedBeforeTrip > 0
                    ? '先清洗 ' + trip.cupsWashedBeforeTrip + ' 個杯子'
                    : '不需先清洗杯子'}
                </p>
                <p>
                  帶 clean cup ×{trip.cleanCupsCarried}（
                  {trip.cleanCupStacks} 疊）
                </p>
                <p>
                  帶果汁罐：
                  {trip.carriedPhysicalJarIds.join('、')}
                </p>
              </div>

              {fillsBeforeTrip.length > 0 && (
                <div className="optimizer-sales-fill-list">
                  <strong>裝罐</strong>
                  {fillsBeforeTrip.map((fill) => (
                    <p
                      key={
                        'trip-fill-' +
                        trip.tripNumber +
                        '-' +
                        fill.physicalJarId +
                        '-' +
                        fill.recipeId
                      }
                    >
                      {fill.physicalJarId} ·{' '}
                      {transactionFillActionLabel(fill)} ·{' '}
                      {formatRecipeDisplayName(fill.recipeName)} +{fill.servings}{' '}
                      杯 → 裝後 {fill.servingsAfterFill} 杯
                    </p>
                  ))}
                </div>
              )}
            </section>

            <section className="optimizer-sales-trip-section">
              <h4>販售</h4>
              <div className="optimizer-sales-jar-list">
                {trip.juiceJars.map((load) => (
                  <article
                    className="optimizer-sales-jar-manifest"
                    key={
                      plan.policy +
                      '-' +
                      trip.tripNumber +
                      '-' +
                      load.physicalJarId
                    }
                  >
                    <header>
                      <div>
                        <strong>{load.physicalJarId}</strong>
                        <span>
                          {formatRecipeDisplayName(load.recipeName)}
                        </span>
                      </div>
                      <span>{load.servings} 杯</span>
                    </header>

                    <div className="optimizer-sales-jar-status">
                      <span>{jarFillActionLabel(load)}</span>
                      {load.retainedLeftoverServings > 0 && (
                        <span>
                          販售後保留 {load.retainedLeftoverServings} 杯
                        </span>
                      )}
                    </div>

                    <div className="optimizer-delivery-customer-list">
                      {load.customerIds.map((customerId) =>
                        deliveryControls ? (
                          <DeliveryCustomerCheckbox
                            key={customerId}
                            customerId={customerId}
                            plan={deliveryControls.plan}
                            cursor={deliveryControls.cursor}
                            suppliedCustomerIds={
                              deliveryControls.suppliedCustomerIds
                            }
                            disabled={deliveryControls.disabled}
                            showPlanningDetail={false}
                            onChange={
                              deliveryControls.onChangeCustomer
                            }
                          />
                        ) : (
                          <SalesTripCustomerRow
                            key={customerId}
                            customerId={customerId}
                          />
                        ),
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="optimizer-sales-trip-section">
              <h4>回工作間</h4>
              <div className="optimizer-sales-action-list">
                <p>
                  回家後 clean {trip.cleanCupsAfterTrip} / used{' '}
                  {trip.usedCupsAfterTrip}
                </p>
                {trip.droppedUsedCups > 0 && (
                  <p className="optimizer-sales-warning">
                    本趟掉落 {trip.droppedUsedCups} 個 used cup
                  </p>
                )}
                {trip.juiceJars
                  .filter(
                    (load) => load.retainedLeftoverServings > 0,
                  )
                  .map((load) => {
                    const laterTrip = plan.trips.find(
                      (candidate) =>
                        candidate.tripNumber > trip.tripNumber &&
                        candidate.carriedPhysicalJarIds.includes(
                          load.physicalJarId,
                        ),
                    )
                    return (
                      <p
                        key={
                          'trip-leftover-' +
                          trip.tripNumber +
                          '-' +
                          load.physicalJarId
                        }
                      >
                        {load.physicalJarId}：
                        {formatRecipeDisplayName(load.recipeName)} 剩{' '}
                        {load.retainedLeftoverServings} 杯
                        {laterTrip
                          ? ' → 第 ' +
                            laterTrip.tripNumber +
                            ' 趟仍隨身'
                          : ' → 留在家中'}
                      </p>
                    )
                  })}
              </div>
            </section>

            <details className="optimizer-sales-detail optimizer-sales-trip-detail">
              <summary>容量／路線細節</summary>
              <div className="optimizer-sales-detail-body">
                <p>
                  果汁罐占用／預留 {trip.juiceJarSlotsCarried} 格 ·
                  出發占用 {trip.departureSlots} /{' '}
                  {trip.effectiveDepartureSlotLimit} slots · 趟中峰值{' '}
                  {trip.peakOccupiedSlots} /{' '}
                  {trip.effectiveDepartureSlotLimit} slots
                </p>
                <p>
                  出發前 clean {trip.cleanCupsBeforeTrip} / used{' '}
                  {trip.usedCupsBeforeTrip} · 回工作間後 clean{' '}
                  {trip.cleanCupsAfterTrip} / used {trip.usedCupsAfterTrip}
                </p>
                {regionTrip && (
                  <>
                    <p>本趟 route cost {regionTrip.routeCost}</p>
                    {regionTrip.routeFootprint.length > 0 && (
                      <p>
                        跨區路線邊：
                        {regionTrip.routeFootprint
                          .map(
                            (edge) =>
                              regionDisplayName(edge.from) +
                              ' ↔ ' +
                              regionDisplayName(edge.to) +
                              ' ×' +
                              edge.traversalCount,
                          )
                          .join('、')}
                      </p>
                    )}
                  </>
                )}
              </div>
            </details>
          </article>
        )
      })}
    </div>
  )
}

export function RemainingSalesTripPlanBlock({
  plan,
  deliveryControls,
}: {
  plan: RemainingSalesTripPlan
  deliveryControls: SalesTripDeliveryControls
}) {
  const recipeNameById = new Map(
    plan.recipes.map((recipe) => [
      recipe.recipeId,
      recipe.recipeName,
    ]),
  )

  return (
    <div className="optimizer-batch-list optimizer-sales-plan optimizer-remaining-sales-plan">
      {plan.regionPlan.trips.map((trip) => {
        const customerIds = trip.services.flatMap((service) =>
          service.customerAssignments.map(
            (assignment) => assignment.customerId,
          ),
        )

        return (
          <article
            className="optimizer-batch-card optimizer-sales-trip-card"
            key={'remaining-trip-' + trip.tripNumber}
          >
            <header className="optimizer-sales-trip-header">
              <div>
                <DeliveryTripGroupCheckbox
                  tripNumber={trip.tripNumber}
                  customerIds={customerIds}
                  plan={deliveryControls.plan}
                  cursor={deliveryControls.cursor}
                  suppliedCustomerIds={
                    deliveryControls.suppliedCustomerIds
                  }
                  disabled={deliveryControls.disabled}
                  onChange={deliveryControls.onChangeGroup}
                />
                <span>{customerIds.length} 人</span>
              </div>

              <div
                className="optimizer-sales-region-chips"
                aria-label={'剩餘第 ' + trip.tripNumber + ' 趟地區'}
              >
                {trip.primaryRegionIds.map((regionId) => (
                  <span
                    className="optimizer-sales-region-chip primary"
                    key={'remaining-primary-' + regionId}
                  >
                    主要 · {regionDisplayName(regionId)}
                  </span>
                ))}
                {trip.sideRegionIds.map((regionId) => (
                  <span
                    className="optimizer-sales-region-chip side"
                    key={'remaining-side-' + regionId}
                  >
                    順帶 · {regionDisplayName(regionId)}
                  </span>
                ))}
                {trip.transitRegionIds.map((regionId) => (
                  <span
                    className="optimizer-sales-region-chip transit"
                    key={'remaining-transit-' + regionId}
                  >
                    途經 · {regionDisplayName(regionId)}
                  </span>
                ))}
              </div>
            </header>

            <section className="optimizer-sales-trip-section">
              <h4>販售</h4>
              <div className="optimizer-sales-jar-list">
                {trip.services.map((service) => (
                  <article
                    className="optimizer-sales-jar-manifest"
                    key={
                      'remaining-service-' +
                      trip.tripNumber +
                      '-' +
                      service.regionId
                    }
                  >
                    <header>
                      <div>
                        <strong>
                          {service.role === 'primary'
                            ? '主要'
                            : '順帶'}{' '}
                          · {regionDisplayName(service.regionId)}
                        </strong>
                        <span>
                          {service.customerAssignments.length} 人
                        </span>
                      </div>
                    </header>

                    <div className="optimizer-delivery-customer-list">
                      {service.customerAssignments.map(
                        (assignment) => (
                          <div
                            className="optimizer-remaining-sales-customer"
                            key={
                              'remaining-customer-' +
                              assignment.customerId
                            }
                          >
                            <DeliveryCustomerCheckbox
                              customerId={assignment.customerId}
                              plan={deliveryControls.plan}
                              cursor={deliveryControls.cursor}
                              suppliedCustomerIds={
                                deliveryControls.suppliedCustomerIds
                              }
                              disabled={deliveryControls.disabled}
                              showPlanningDetail={false}
                              onChange={
                                deliveryControls.onChangeCustomer
                              }
                            />
                            <small>
                              {formatRecipeDisplayName(
                                recipeNameById.get(
                                  assignment.recipeId,
                                ) ?? assignment.recipeId,
                              )}
                            </small>
                          </div>
                        ),
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </article>
        )
      })}
    </div>
  )
}

function MetricCard({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="optimizer-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
