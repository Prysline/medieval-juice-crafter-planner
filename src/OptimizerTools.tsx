import { memo, useEffect, useId, useMemo, useState } from 'react'
import { customers } from './data/customers'
import { ingredients } from './data/ingredients'
import { recipes } from './data/recipes'
import { ingredientIsAvailable } from './domain/availability'
import {
  optimizerCustomerIds,
  optimizerCustomerLabel,
  optimizerMoney,
  optimizerOperationQuantities,
  optimizerWaterFetchSlots,
  type OptimizerCustomerScope,
} from './domain/optimizerUi'
import type {
  OptimizationCandidatePolicy,
  OptimizationCriterion,
  OptimizationResult,
} from './domain/optimizer'
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
  recipeCandidateEntriesForInventoryEditor,
  type RecipeCandidatePool,
  type RecipeCandidatePoolEntry,
} from './domain/recipeCandidatePool'
import type { ProductionLogisticsPlan } from './domain/productionLogistics'
import type { PlanApplicationTransactionDraft } from './domain/planApplicationTransaction'
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
  alternate: MultiTripReplenishmentPlan | null
  alternatePolicy: UsedCupTripPolicy
  alternateError: string | null
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

const customerById = new Map(
  customers.map((customer) => [customer.id, customer]),
)
const ingredientNameById = new Map(
  ingredients.map((ingredient) => [ingredient.id, ingredient.name]),
)
const recipeNameById = new Map(
  recipes.map((recipe) => [recipe.id, recipe.name]),
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

function ingredientLabel(ingredientId: string): string {
  return ingredientNameById.get(ingredientId) ?? ingredientId
}

function sequenceLabel(ingredientIds: string[]): string {
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

export const INVENTORY_RECIPE_SEARCH_RESULT_LIMIT = 8

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
  if (entry.sources.includes('saved')) labels.push('已保存')
  if (
    entry.sources.includes('computed') &&
    !entry.sources.includes('observed')
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
  const [candidatePolicy, setCandidatePolicy] =
    useState<OptimizationCandidatePolicy>('observed-only')
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
  const [runState, setRunState] = useState<OptimizerRunState>({
    status: 'idle',
  })
  const [applicationState, setApplicationState] =
    useState<PlanApplicationUiState>({ status: 'idle' })

  const priorities = useMemo(
    () => uniquePriorities(primaryCriterion, secondaryOne, secondaryTwo),
    [primaryCriterion, secondaryOne, secondaryTwo],
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

  const accessibleJuiceJars = useMemo(
    () => selectAccessibleJuiceJars(inventoryState),
    [inventoryState],
  )

  const capacitySummary = useMemo(
    () => buildInventoryCapacitySummary(inventoryState, plannerSettings),
    [inventoryState, plannerSettings],
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


  const customerIds = useMemo(
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

  useEffect(() => {
    setRunState({ status: 'idle' })
  }, [
    currentProgress,
    satisfactionByVillage,
    suppliedCustomerIds,
    formalCustomerIds,
    scope,
    candidatePolicy,
    priorities,
    inventoryState,
    plannerSettings,
    maxJarTypeSwitches,
    recipeCandidatePool,
  ])

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
  }

  async function runOptimizer() {
    setApplicationState({ status: 'idle' })
    setRunState({ status: 'loading' })

    try {
      const [
        { optimizeBatchPlan },
        { buildPreparationDemand },
        { buildPreparationShortfall },
        { buildProductionLogisticsPlan },
        { buildMultiTripReplenishmentPlan },
        { buildPlanApplicationTransactionDraft },
      ] = await Promise.all([
        import('./domain/optimizer'),
        import('./domain/preparationDemand'),
        import('./domain/preparationShortfall'),
        import('./domain/productionLogistics'),
        import('./domain/multiTripReplenishment'),
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

      const result = await optimizeBatchPlan(
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
          source: {
            customers,
            candidatePool: recipeCandidatePool,
          },
        },
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

      const buildCheckedSalesTripPlan = (
        policy: UsedCupTripPolicy,
      ): MultiTripReplenishmentPlan => {
        const plan = buildMultiTripReplenishmentPlan(
          preparationDemand,
          policy,
          accessibleJuiceJars,
          {
            cleanCups: inventoryState.cleanCups,
            usedCups: inventoryState.usedCups,
          },
          preparationShortfall,
          {
            mode: plannerSettings.juiceJarCarryMode,
            reservedSlots: plannerSettings.reservedJuiceJarSlots,
            minimumCarriedSlots:
              capacitySummary.minimumCarriedJuiceJarSlots,
          },
          plannerSettings.allowDiscardRetainedJuice,
        )
        if (plan.jarTypeSwitches !== result.jarTypeSwitches) {
          throw new PlanningUserError(
            'jar-schedule-inconsistency',
            {
              expectedJarTypeSwitches: result.jarTypeSwitches,
              actualJarTypeSwitches: plan.jarTypeSwitches,
            },
            `Optimizer reported ${result.jarTypeSwitches} jar switch(es), but the physical schedule realized ${plan.jarTypeSwitches}`,
          )
        }
        return plan
      }

      const selectedSalesTripPlan =
        buildCheckedSalesTripPlan(selectedPolicy)
      const productionLogistics = buildProductionLogisticsPlan(
        preparationShortfall,
        inventoryState,
        plannerSettings,
        selectedSalesTripPlan.productionJarFills,
      )
      let alternateSalesTripPlan: MultiTripReplenishmentPlan | null = null
      let alternateError: string | null = null
      try {
        alternateSalesTripPlan =
          buildCheckedSalesTripPlan(alternatePolicy)
      } catch (error) {
        alternateError = presentPlanningError(error).message
      }

      const salesTripPlans: SalesTripPlans = {
        selected: selectedSalesTripPlan,
        alternate: alternateSalesTripPlan,
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

      setRunState({
        status: 'success',
        result,
        preparationShortfall,
        productionLogistics,
        salesTripPlans,
        transactionDraft,
      })
    } catch (error) {
      setRunState({
        status: 'error',
        error: presentPlanningError(error),
      })
    }
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
            <legend>顧客範圍</legend>
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
              <option value="observed-only">只用已實測配方</option>
              <option value="allow-unambiguous-computed">
                允許無歧義預測配方
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
            ? '正在載入求解器並規劃…'
            : '產生最佳化規劃'}
        </button>

        <p className="optimizer-lazy-note">
          求解器只會在按下規劃後 lazy-load；第一次執行需要載入 HiGHS WASM。
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

      {runState.status === 'success' && (
        <OptimizerResultPanel
          result={runState.result}
          preparationShortfall={runState.preparationShortfall}
          productionLogistics={runState.productionLogistics}
          priorities={priorities}
          salesTripPlans={runState.salesTripPlans}
          transactionDraft={runState.transactionDraft}
          onApplyTransaction={applyTransactionDraft}
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

function MachineBatchFlow({
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
  onApply,
}: {
  draft: PlanApplicationTransactionDraft
  productionJarFills: readonly MultiTripProductionJarFill[]
  onApply: (draft: PlanApplicationTransactionDraft) => void
}) {
  const changes = draft.changes

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
                  <strong>{ingredientLabel(change.ingredientId)}</strong>
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
          <span>{changes.juiceJars.length} 個期末內容變更</span>
        </div>

        {changes.juiceJars.length === 0 ? (
          <p>期末沒有果汁罐內容變更。</p>
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

function OptimizerResultPanel({
  result,
  preparationShortfall,
  productionLogistics,
  priorities,
  salesTripPlans,
  transactionDraft,
  onApplyTransaction,
}: {
  result: OptimizationResult
  preparationShortfall: PreparationShortfall
  productionLogistics: ProductionLogisticsPlan
  priorities: OptimizationCriterion[]
  salesTripPlans: SalesTripPlans
  transactionDraft: PlanApplicationTransactionDraft | null
  onApplyTransaction: (draft: PlanApplicationTransactionDraft) => void
}) {
  const selectedSalesTripPlan = salesTripPlans.selected
  const alternateSalesTripPlan = salesTripPlans.alternate
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
  const productionStepsByEquipment =
    productionLogistics.productionPlan.steps.reduce<
      Record<string, ProductionLogisticsPlan['productionPlan']['steps']>
    >((groups, step) => {
    ;(groups[step.equipment] ??= []).push(step)
    return groups
  }, {})

  return (
    <div className="optimizer-results">
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
          label="果汁罐換裝"
          value={result.jarTypeSwitches + ' 次'}
        />
        <MetricCard
          label="販售趟數（目前策略）"
          value={selectedSalesTripPlan.tripCount + ' 趟'}
        />
        <MetricCard
          label="已分配 / 產出"
          value={result.assignedServings + ' / ' + result.producedServings}
        />
        <MetricCard label="剩餘杯" value={String(result.leftoverServings)} />
      </div>

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
          onApply={onApplyTransaction}
        />
      ) : (
        <section
          className="optimizer-result-section optimizer-transaction-preview"
          aria-label="套用規劃預覽"
        >
          <div className="section-title">
            <strong>套用規劃預覽</strong>
            <span>目前無法建立</span>
          </div>
          <p className="optimizer-transaction-warning">
            目前製作物流不可行，因此不建立交易草稿，也不會修改庫存。請先處理下方製作物流警告後重新產生規劃。
          </p>
        </section>
      )}

      <section className="optimizer-result-section">
        <div className="section-title">
          <strong>所需物資</strong>
          <span>先看需求，再分購買／免費取得</span>
        </div>

        <div className="optimizer-batch-list">
          <article className="optimizer-batch-card">
            <div>
              <strong>原料</strong>
              <span>{preparationShortfall.ingredients.length} 種實際製作需求</span>
            </div>
            {preparationShortfall.ingredients.length === 0 ? (
              <p>目前成品庫存已足夠，不需再消耗新原料。</p>
            ) : (
              <div className="optimizer-shopping-list">
                {preparationShortfall.ingredients.map((item) => {
                  const purchaseItem = purchaseItemByIngredientId.get(
                    item.ingredientId,
                  )
                  return (
                    <div
                      className="optimizer-shopping-row"
                      key={item.ingredientId}
                    >
                      <strong>{item.name}</strong>
                      <div className="optimizer-shopping-values">
                        <span>需求：{item.requiredUnits} 單位</span>
                        <span>
                          現有：{item.inventoryUnitsAvailable} 單位 · 使用{' '}
                          {item.inventoryUnitsUsed} 單位
                        </span>
                        <span>
                          {item.purchaseUnits > 0
                            ? '需購買：' + item.purchaseUnits + ' 單位'
                            : '需購買：0（庫存足夠）'}
                        </span>
                        {item.purchaseUnits > 0 && purchaseItem && (
                          <span>
                            購買小計：
                            {optimizerMoney(
                              item.purchaseUnits * purchaseItem.unitPrice,
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </article>

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
                  {steps.map((step) => (
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
                  ))}
                </div>
              </section>
            ),
          )
        )}

        <small className="optimizer-boundary-note">
          ▸ 表示配方內部原料順序；→ 只表示實際加工或狀態轉換。此區顯示庫存抵扣後真正需要執行的製作量；每個膠囊代表一個機器 slot 內的原料、果汁、水或輸出。勾選狀態綁定目前 net production plan；重新產生相同規劃可恢復，規劃內容不同時不會套用舊進度。
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
          <span>{result.recipePlans.length} 種</span>
        </div>
        {result.recipePlans.length === 0 ? (
          <p className="empty-tool-state">本次沒有可製作的果汁。</p>
        ) : (
          <div className="optimizer-batch-list">
            {result.recipePlans.map((plan) => (
              <article className="optimizer-batch-card" key={plan.recipeId}>
                <div>
                  <strong>{formatRecipeDisplayName(plan.recipeName)}</strong>
                  <span>
                    原料成本：{optimizerMoney(plan.totalIngredientCost)}
                  </span>
                </div>
                <p>
                  顧客：{plan.customerIds.map(customerLabel).join('、')}
                </p>
                <p>
                  需求 {plan.assignedServings} 杯 · 製作果汁 {plan.juiceUnits}{' '}
                  份 → {plan.producedServings} 杯
                  {plan.leftoverServings > 0
                    ? ' · 剩餘 ' + plan.leftoverServings + ' 杯'
                    : ''}
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

        <SalesTripPlanBlock plan={selectedSalesTripPlan} />

        <details className="optimizer-policy-comparison">
          <summary>
            比較替代策略：{usedCupPolicyLabel(salesTripPlans.alternatePolicy)}
            {alternateSalesTripPlan
              ? '（' + alternateSalesTripPlan.tripCount + ' 趟）'
              : '（目前不可行）'}
          </summary>
          {alternateSalesTripPlan ? (
            <SalesTripPlanBlock plan={alternateSalesTripPlan} />
          ) : (
            <p className="optimizer-policy-unavailable">
              {salesTripPlans.alternateError ??
                '替代杯具策略目前無法產生可行排程。'}
            </p>
          )}
        </details>

        <small className="optimizer-boundary-note">
          兩種 policy 都使用實際持有杯數與逐杯 clean → used stack transition 驗證可行性；回家清洗會計入杯數與用水，掉落只代表 NPC 回傳時背包無空位。這裡仍不推導跨村路線、顧客順序或到達時間。
        </small>
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

function SalesTripPlanBlock({
  plan,
}: {
  plan: MultiTripReplenishmentPlan
}) {
  return (
    <div className="optimizer-batch-list">
      <article className="optimizer-batch-card">
        <div>
          <strong>{tripPolicyLabel(plan)}</strong>
          <span>
            {plan.tripCount} 趟 · 果汁罐換裝 {plan.jarTypeSwitches} 次
          </span>
        </div>
        <p>
          販售排程使用 {plan.physicalJarsUsed} / {plan.carriedJuiceJarCount}{' '}
          個實體果汁罐；單趟最多使用 {plan.maxJuiceJarSlotsCarried} 個果汁罐格。
        </p>
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
              return jar.physicalJarId + '（' + initial + '）'
            })
            .join('、')}
        </p>
        <p>
          杯具：起始 clean {plan.initialCleanCups} / used {plan.initialUsedCups}
          {' · '}清洗 {plan.totalCupWashWaterUnits} 次／用水 {plan.totalCupWashWaterUnits}
          {' · '}結束實體杯 {plan.finalPhysicalCupCount}
          {plan.droppedUsedCups > 0 ? ' · 掉落 ' + plan.droppedUsedCups : ''}
        </p>
        <p>
          販售後保留成品 {plan.totalLeftoverServings} 杯
          {plan.totalLeftoverServings > 0
            ? ' · 分布於 ' + plan.leftoverJarContents.length + ' 個 physical jar 記錄'
            : ''}
        </p>
        <small>
          {tripPolicyNote(plan)}
          {plan.totalLeftoverServings > 0
            ? ' 剩餘成品只會留在該 recipe 最後販售的同一 persistent physical jar；目前仍不寫回 inventory，跨日 commit 留待 Apply Plan。'
            : ''}
          {' '}所有持有果汁罐的既有內容都會納入今日販售來源；有果汁罐架時可在趟次之間整罐上架／換罐，未被今日需求喝空的既有內容不會為了減少換裝而自動丟棄。
        </small>
      </article>

      {plan.trips.map((trip) => (
        <article
          className="optimizer-batch-card"
          key={plan.policy + '-' + trip.tripNumber}
        >
          <div>
            <strong>第 {trip.tripNumber} 趟</strong>
            <span>
              {trip.totalServings} 杯 · 販售用 {trip.juiceJars.length} 罐 ·
              實際隨身 {trip.carriedPhysicalJarIds.length} 罐
            </span>
          </div>
          <p>
            隨身果汁罐：{trip.carriedPhysicalJarIds.join('、')}
            {' · '}果汁罐占用／預留 {trip.juiceJarSlotsCarried} 格
          </p>
          <p>
            帶出 clean cup {trip.cleanCupsCarried} 個 / {trip.cleanCupStacks} 疊
            {' · '}出發占用 {trip.departureSlots} / {trip.effectiveDepartureSlotLimit} slots
            {' · '}趟中峰值 {trip.peakOccupiedSlots} / {trip.effectiveDepartureSlotLimit} slots
          </p>
          <p>
            出發前 clean {trip.cleanCupsBeforeTrip} / used {trip.usedCupsBeforeTrip}
            {trip.cupsWashedBeforeTrip > 0
              ? ' · 先清洗 ' + trip.cupsWashedBeforeTrip + ' 個'
              : ' · 不需先清洗'}
            {' · '}回家後 clean {trip.cleanCupsAfterTrip} / used {trip.usedCupsAfterTrip}
            {trip.droppedUsedCups > 0
              ? ' · 本趟掉落 ' + trip.droppedUsedCups + ' 個 used cup'
              : ''}
          </p>
          {trip.juiceJars.map((load) => (
            <div
              key={
                plan.policy +
                '-' +
                trip.tripNumber +
                '-' +
                load.physicalJarId
              }
            >
              <p>
                果汁罐 {load.physicalJarId}：{formatRecipeDisplayName(load.recipeName)} · 販售 {load.servings}{' '}
                杯
                {load.retainedLeftoverServings > 0
                  ? ' · 販售後保留 ' + load.retainedLeftoverServings + ' 杯'
                  : ''}
                {' · '}{jarFillActionLabel(load)}
              </p>
              <p>
                完整符合顧客：{load.customerIds.map(customerLabel).join('、')}
              </p>
            </div>
          ))}
        </article>
      ))}
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
