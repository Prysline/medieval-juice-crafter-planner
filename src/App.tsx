import { memo, startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import OptimizerTools from './OptimizerTools'
import RecipeTools from './RecipeTools'
import { customers } from './data/customers'
import { ingredients } from './data/ingredients'
import { progressMilestoneLabels, progressMilestones } from './data/progress'
import { villageNames, villages } from './data/villages'
import {
  customerIsUnlocked,
  customerVillageIsAvailable,
  isAvailableAtProgress,
} from './domain/availability'
import {
  sortCustomerRows,
  type CustomerSortKey,
  type SortDirection,
} from './domain/customerList'
import {
  customerRecipeRecommendationsFromSearch,
  sortFullMatchCandidatesByIngredientCost,
  type CustomerRecipeRecommendations,
  type RecommendationCostMode,
} from './domain/customerRecommendation'
import { isFormalCustomer } from './domain/customerState'
import {
  matchingRecipeCandidatesForCustomer,
  recipeCandidateMatchesCustomer,
} from './domain/matching'
import {
  buildRecipeCandidatePool,
  recipeCandidatesInCurrentSearchScope,
  type RecipeCandidatePool,
  type RecipeCandidatePoolEntry,
  type RecipeCandidatePoolSource,
} from './domain/recipeCandidatePool'
import {
  customerMatchesResearchFilters,
  recipeEntryMatchesResearchFilters,
  type FilterMatchMode,
  type RecipePriceFilter,
  type RecipeSourceFilter,
} from './domain/listFilters'
import {
  searchRecipeCandidatesForCustomer,
  type ProgressiveRecipeSearchResult,
} from './domain/recipeSearch'
import {
  buildRecipeIngredientEntryIndex,
  recipeEntriesForContiguousSequence,
} from './domain/recipeSequenceIndex'
import {
  calculateRecipeIngredientCost,
  type RecipeIngredientCost,
} from './domain/recipeCost'
import {
  formatMoney,
  formatRecipeDisplayName,
  formatRecipeIngredientCost,
  formatRecipeSequence,
} from './domain/displayFormat'
import {
  readCurrentProgress,
  readFormalCustomerIds,
  readSatisfactionByVillage,
  readSuppliedCustomerIds,
  writeCurrentProgress,
  writeFormalCustomerIds,
  writeSatisfactionByVillage,
  writeSuppliedCustomerIds,
} from './storage/plannerState'
import { readSavedRecipes } from './storage/savedRecipes'
import type {
  Customer,
  EffectValue,
  ProgressMilestoneId,
  RecipeCandidate,
  SavedRecipe,
  SatisfactionByVillage,
  VillageId,
} from './types'

type Tab = 'customers' | 'recipes' | 'tools' | 'optimizer'
type RecipeSortKey = 'name' | 'salePrice'
type CustomerVisibility = 'available' | 'all'

const RECIPE_PAGE_SIZE = 50
const ingredientNameById = new Map(
  ingredients.map((ingredient) => [ingredient.id, ingredient.name]),
)
const MemoizedOptimizerTools = memo(OptimizerTools)
const MemoizedRecipeRow = memo(RecipeRow)

const scheduleLabels = {
  leave_home: '出家門',
  outside_village_by: '已在村外',
  return_village: '回村',
} as const

function formatEffect(effect: EffectValue) {
  return `${effect.name}（${effect.value}）`
}

function recipePoolSourceLabel(source: RecipeCandidatePoolSource): string {
  if (source === 'observed') return '實測'
  if (source === 'personal') return '個人已確認'
  if (source === 'saved') return '已保存'
  if (source === 'computed') return '安全推導'
  return '歧義推導'
}

function recipeEntrySourceLabel(entry: RecipeCandidatePoolEntry): string {
  return entry.sources.map(recipePoolSourceLabel).join('・')
}

export type SatisfactionVillageDefinition<TVillageId extends string> = {
  id: TVillageId
  name: string
  unlockedAt: ProgressMilestoneId
}

export function satisfactionFieldsAtProgress<TVillageId extends string>(
  villageDefinitions: readonly SatisfactionVillageDefinition<TVillageId>[],
  currentProgress: ProgressMilestoneId,
  satisfactionByVillage: Readonly<Record<TVillageId, number>>,
) {
  return villageDefinitions
    .filter((village) =>
      isAvailableAtProgress(village.unlockedAt, currentProgress),
    )
    .map((village) => ({
      id: village.id,
      name: village.name,
      value: satisfactionByVillage[village.id] ?? 0,
    }))
}

export function withSatisfactionUpdate<TVillageId extends string>(
  current: Readonly<Record<TVillageId, number>>,
  villageId: TVillageId,
  value: number,
): Record<TVillageId, number> {
  return {
    ...current,
    [villageId]: Math.max(0, Math.floor(value || 0)),
  }
}

export function SatisfactionFields<TVillageId extends string>({
  villageDefinitions,
  currentProgress,
  satisfactionByVillage,
  onSatisfactionChange,
}: {
  villageDefinitions: readonly SatisfactionVillageDefinition<TVillageId>[]
  currentProgress: ProgressMilestoneId
  satisfactionByVillage: Readonly<Record<TVillageId, number>>
  onSatisfactionChange: (villageId: TVillageId, value: number) => void
}) {
  return (
    <>
      {satisfactionFieldsAtProgress(
        villageDefinitions,
        currentProgress,
        satisfactionByVillage,
      ).map((village) => (
        <label key={village.id}>
          <span>{village.name}顧客滿意度</span>
          <input
            inputMode="numeric"
            min={0}
            type="number"
            value={village.value}
            onChange={(event) =>
              onSatisfactionChange(
                village.id,
                Number(event.target.value),
              )
            }
          />
        </label>
      ))}
    </>
  )
}

export function formalCustomerStatsAtProgress<TVillageId extends string>(
  villageDefinitions: readonly SatisfactionVillageDefinition<TVillageId>[],
  currentProgress: ProgressMilestoneId,
  customerDefinitions: readonly { id: string; villageId: TVillageId }[],
  formalCustomerIds: readonly string[],
) {
  const formalIds = new Set(formalCustomerIds)

  return villageDefinitions
    .filter((village) =>
      isAvailableAtProgress(village.unlockedAt, currentProgress),
    )
    .map((village) => ({
      id: village.id,
      name: village.name,
      count: customerDefinitions.filter(
        (customer) =>
          customer.villageId === village.id && formalIds.has(customer.id),
      ).length,
    }))
}

function formalCustomerProgressNote(
  villageId: string,
  formalCount: number,
): string {
  if (villageId === 'east-harbor') {
    return `階段三 ${Math.min(formalCount, 14)}/14 · 階段四 ${Math.min(formalCount, 17)}/17`
  }

  return '目前沒有已確認的正式顧客數主線門檻'
}

export function FormalCustomerStats<TVillageId extends string>({
  villageDefinitions,
  currentProgress,
  customerDefinitions,
  formalCustomerIds,
}: {
  villageDefinitions: readonly SatisfactionVillageDefinition<TVillageId>[]
  currentProgress: ProgressMilestoneId
  customerDefinitions: readonly { id: string; villageId: TVillageId }[]
  formalCustomerIds: readonly string[]
}) {
  return (
    <>
      {formalCustomerStatsAtProgress(
        villageDefinitions,
        currentProgress,
        customerDefinitions,
        formalCustomerIds,
      ).map((village) => (
        <div className="progress-stat" key={village.id}>
          <span>{village.name}正式顧客</span>
          <strong>{village.count} 人</strong>
          <small>{formalCustomerProgressNote(village.id, village.count)}</small>
        </div>
      ))}
    </>
  )
}

export type CustomerRecipeSearches = {
  observedOnly: ProgressiveRecipeSearchResult
  allowComputed: ProgressiveRecipeSearchResult
}

export function buildCustomerRecipeSearches(
  recipeCandidatePool: RecipeCandidatePool,
  currentProgress: ProgressMilestoneId,
): Map<string, CustomerRecipeSearches> {
  return new Map(
    customers.map((customer) => [
      customer.id,
      {
        observedOnly: searchRecipeCandidatesForCustomer(
          recipeCandidatePool,
          currentProgress,
          customer,
          {
            candidatePolicy: 'observed-only',
            mode: 'bounded-exhaustive',
          },
        ),
        allowComputed: searchRecipeCandidatesForCustomer(
          recipeCandidatePool,
          currentProgress,
          customer,
          {
            candidatePolicy: 'allow-unambiguous-computed',
            mode: 'bounded-exhaustive',
          },
        ),
      },
    ]),
  )
}

function App() {
  const [currentProgress, setCurrentProgress] = useState<ProgressMilestoneId>(() =>
    readCurrentProgress(window.localStorage),
  )
  const [satisfactionByVillage, setSatisfactionByVillage] =
    useState<SatisfactionByVillage>(() =>
      readSatisfactionByVillage(window.localStorage),
    )
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('customers')
  const [customerSortKey, setCustomerSortKey] =
    useState<CustomerSortKey>('bestMatch')
  const [customerVisibility, setCustomerVisibility] =
    useState<CustomerVisibility>('available')
  const [customerSortDirection, setCustomerSortDirection] =
    useState<SortDirection>('asc')
  const [customerVillageFilter, setCustomerVillageFilter] =
    useState<VillageId | null>(null)
  const [
    customerPreferenceIngredientFilter,
    setCustomerPreferenceIngredientFilter,
  ] = useState<string | null>(null)
  const [
    customerPreferenceEffectFilter,
    setCustomerPreferenceEffectFilter,
  ] = useState<string | null>(null)
  const [customerPreferenceMode, setCustomerPreferenceMode] =
    useState<FilterMatchMode>('all')
  const [
    customerRecommendationCostMode,
    setCustomerRecommendationCostMode,
  ] = useState<RecommendationCostMode>('minimum')
  const [recipeSortKey, setRecipeSortKey] = useState<RecipeSortKey>('salePrice')
  const [recipeSortDirection, setRecipeSortDirection] =
    useState<SortDirection>('desc')
  const [recipeSourceFilter, setRecipeSourceFilter] =
    useState<RecipeSourceFilter>('all')
  const [recipePriceFilter, setRecipePriceFilter] =
    useState<RecipePriceFilter>('all')
  const [recipeIngredientCountFilter, setRecipeIngredientCountFilter] =
    useState<number | null>(null)
  const [
    recipeIngredientSequenceFilter,
    setRecipeIngredientSequenceFilter,
  ] = useState<string[]>([])
  const [recipeConfirmedEffectFilter, setRecipeConfirmedEffectFilter] =
    useState<string | null>(null)
  const [recipePossibleEffectFilter, setRecipePossibleEffectFilter] =
    useState<string | null>(null)
  const [recipePage, setRecipePage] = useState(1)
  const [suppliedCustomerIds, setSuppliedCustomerIds] = useState<string[]>(() =>
    readSuppliedCustomerIds(window.localStorage),
  )
  const [formalCustomerIds, setFormalCustomerIds] = useState<string[]>(() =>
    readFormalCustomerIds(window.localStorage),
  )
  const [savedRecipes, setSavedRecipes] = useState<SavedRecipe[]>(() =>
    readSavedRecipes(window.localStorage),
  )
  const [comparisonCustomerIds, setComparisonCustomerIds] = useState<string[]>([])
  const [showSuppliedToday, setShowSuppliedToday] = useState(true)

  const deferredSatisfactionByVillage =
    useDeferredValue(satisfactionByVillage)
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-Hant')
  const normalizedCustomerQuery =
    tab === 'customers' ? normalizedQuery : ''
  const normalizedRecipeQuery =
    tab === 'recipes' ? normalizedQuery : ''
  const recipeCandidatePool = useMemo(
    () => buildRecipeCandidatePool(currentProgress, savedRecipes),
    [currentProgress, savedRecipes],
  )
  const recipeCandidates = useMemo(
    () => recipeCandidatesInCurrentSearchScope(recipeCandidatePool),
    [recipeCandidatePool],
  )
  const recipeListEntries = useMemo(
    () =>
      recipeCandidatePool.entries.filter(
        (entry) =>
          entry.availableAtCurrentProgress &&
          (
            entry.inGeneratedSearchScope ||
            entry.sources.includes('saved') ||
            entry.sources.includes('observed')
          ),
      ),
    [recipeCandidatePool],
  )
  const recipeIngredientEntryIndex = useMemo(
    () => buildRecipeIngredientEntryIndex(recipeListEntries),
    [recipeListEntries],
  )
  const recipeSequenceEntries = useMemo(
    () =>
      recipeEntriesForContiguousSequence(
        recipeListEntries,
        recipeIngredientEntryIndex,
        recipeIngredientSequenceFilter,
      ),
    [
      recipeIngredientSequenceFilter,
      recipeListEntries,
      recipeIngredientEntryIndex,
    ],
  )
  const recipeOrder = useMemo(
    () =>
      new Map(
        recipeCandidates.map((candidate, index) => [candidate.id, index]),
      ),
    [recipeCandidates],
  )
  const recipeListOrder = useMemo(
    () =>
      new Map(
        recipeListEntries.map((entry, index) => [entry.id, index]),
      ),
    [recipeListEntries],
  )
  const recipeSearchTextById = useMemo(
    () =>
      new Map(
        recipeListEntries.map((entry) => {
          const recipe = entry.candidate
          return [
            entry.id,
            [
              recipe.name,
              ...recipe.ingredients,
              ...recipe.effects.map((effect) => effect.name),
              ...(recipe.effectAmbiguity?.candidates.map(
                (effect) => effect.name,
              ) ?? []),
              ...recipe.equipment,
            ]
              .join(' ')
              .toLocaleLowerCase('zh-Hant'),
          ] as const
        }),
      ),
    [recipeListEntries],
  )
  const customerPreferenceIngredientOptions = useMemo(
    () =>
      [...new Set(
        customers.flatMap((customer) =>
          (customer.preferences ?? [])
            .filter((preference) => preference.kind === 'ingredient')
            .map((preference) => preference.value),
        ),
      )].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
    [],
  )
  const customerPreferenceEffectOptions = useMemo(
    () =>
      [...new Set(
        customers.flatMap((customer) =>
          (customer.preferences ?? [])
            .filter((preference) => preference.kind === 'effect')
            .map((preference) => preference.value),
        ),
      )].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
    [],
  )
  const recipeIngredientCountOptions = useMemo(
    () =>
      [...new Set(recipeListEntries.map((entry) => entry.ingredientIds.length))]
        .sort((a, b) => a - b),
    [recipeListEntries],
  )
  const recipeSequenceIngredientOptions = useMemo(
    () =>
      ingredients.filter((ingredient) =>
        isAvailableAtProgress(ingredient.unlockedAt, currentProgress),
      ),
    [currentProgress],
  )
  const recipeConfirmedEffectOptions = useMemo(
    () =>
      [...new Set(
        recipeListEntries.flatMap((entry) =>
          entry.candidate.effects.map((effect) => effect.name),
        ),
      )].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
    [recipeListEntries],
  )
  const recipePossibleEffectOptions = useMemo(
    () =>
      [...new Set(
        recipeListEntries.flatMap((entry) =>
          entry.candidate.effectAmbiguity?.candidates.map(
            (effect) => effect.name,
          ) ?? [],
        ),
      )].sort((a, b) => a.localeCompare(b, 'zh-Hant')),
    [recipeListEntries],
  )

  const customerSearchesByCustomerId = useMemo(
    () =>
      buildCustomerRecipeSearches(
        recipeCandidatePool,
        currentProgress,
      ),
    [recipeCandidatePool, currentProgress],
  )

  const customerRecommendationRows = useMemo(
    () =>
      customers
        .filter((customer) =>
          customerVillageIsAvailable(customer, currentProgress),
        )
        .map((customer) => {
          const searches = customerSearchesByCustomerId.get(customer.id)
          const candidates = searches?.allowComputed.candidates ?? []

          return {
            customer,
            matches: sortFullMatchCandidatesByIngredientCost(
              matchingRecipeCandidatesForCustomer(
                [...candidates],
                customer,
              ),
              customerRecommendationCostMode,
            ),
            recommendations: customerRecipeRecommendationsFromSearch(
              searches?.observedOnly.candidates ?? [],
              searches?.allowComputed.candidates ?? [],
              customer,
              customerRecommendationCostMode,
            ),
          }
        }),
    [
      currentProgress,
      customerSearchesByCustomerId,
      customerRecommendationCostMode,
    ],
  )

  const customerRows = useMemo(() => {
    const rows = customerRecommendationRows
      .map((row) => ({
        ...row,
        unlocked: customerIsUnlocked(
          row.customer,
          currentProgress,
          satisfactionByVillage,
        ),
      }))
      .filter(({ unlocked }) => customerVisibility === 'all' || unlocked)
      .filter(({ customer }) =>
        customerMatchesResearchFilters(customer, {
          villageId: customerVillageFilter,
          preferenceIngredient: customerPreferenceIngredientFilter,
          preferenceEffect: customerPreferenceEffectFilter,
          preferenceMode: customerPreferenceMode,
        }),
      )

    const supplied = new Set(suppliedCustomerIds)
    const suppliedFilteredRows = showSuppliedToday
      ? rows
      : rows.filter(({ customer }) => !supplied.has(customer.id))

    const searchedRows = suppliedFilteredRows.filter(({ customer, matches }) => {
      if (!normalizedCustomerQuery) return true
      const haystack = [
        customer.name,
        customer.occupation,
        ...(customer.preferences ?? []).map((preference) => preference.value),
        ...matches.map((recipe) => recipe.name),
      ]
        .join(' ')
        .toLocaleLowerCase('zh-Hant')
      return haystack.includes(normalizedCustomerQuery)
    })

    const rowByCustomerId = new Map(
      searchedRows.map((row) => [row.customer.id, row]),
    )

    return sortCustomerRows(
      searchedRows,
      customerSortKey,
      customerSortDirection,
      recipeOrder,
    ).map((row) => rowByCustomerId.get(row.customer.id)!)
  }, [
    normalizedCustomerQuery,
    customerRecommendationRows,
    currentProgress,
    satisfactionByVillage,
    recipeOrder,
    customerVisibility,
    customerVillageFilter,
    customerPreferenceIngredientFilter,
    customerPreferenceEffectFilter,
    customerPreferenceMode,
    showSuppliedToday,
    suppliedCustomerIds,
    customerSortDirection,
    customerSortKey,
  ])

  const sortedRecipeSequenceEntries = useMemo(() => {
    const direction = recipeSortDirection === 'asc' ? 1 : -1

    return [...recipeSequenceEntries].sort((a, b) => {
      const left = a.candidate
      const right = b.candidate

      if (recipeSortKey === 'salePrice') {
        if (left.salePrice === null && right.salePrice === null) {
          return (
            ((recipeListOrder.get(a.id) ?? 0) -
              (recipeListOrder.get(b.id) ?? 0)) *
            direction
          )
        }
        if (left.salePrice === null) return 1
        if (right.salePrice === null) return -1
        return (
          (left.salePrice - right.salePrice) * direction ||
          (recipeListOrder.get(a.id) ?? 0) -
            (recipeListOrder.get(b.id) ?? 0)
        )
      }

      return left.name.localeCompare(right.name, 'zh-Hant') * direction
    })
  }, [
    recipeSequenceEntries,
    recipeListOrder,
    recipeSortDirection,
    recipeSortKey,
  ])

  const researchFilteredRecipeEntries = useMemo(
    () =>
      sortedRecipeSequenceEntries.filter((entry) =>
        recipeEntryMatchesResearchFilters(entry, {
          ingredientCount: recipeIngredientCountFilter,
          ingredientId: null,
          confirmedEffect: recipeConfirmedEffectFilter,
          possibleEffect: recipePossibleEffectFilter,
          source: recipeSourceFilter,
          price: recipePriceFilter,
        }),
      ),
    [
      sortedRecipeSequenceEntries,
      recipeIngredientCountFilter,
      recipeConfirmedEffectFilter,
      recipePossibleEffectFilter,
      recipePriceFilter,
      recipeSourceFilter,
    ],
  )

  const recipeRows = useMemo(() => {
    if (!normalizedRecipeQuery) return researchFilteredRecipeEntries

    return researchFilteredRecipeEntries.filter(
      (entry) =>
        recipeSearchTextById
          .get(entry.id)
          ?.includes(normalizedRecipeQuery) ?? false,
    )
  }, [
    normalizedRecipeQuery,
    researchFilteredRecipeEntries,
    recipeSearchTextById,
  ])

  const recipePageCount = Math.max(
    1,
    Math.ceil(recipeRows.length / RECIPE_PAGE_SIZE),
  )
  const boundedRecipePage = Math.min(recipePage, recipePageCount)
  const pagedRecipeRows = useMemo(() => {
    const start = (boundedRecipePage - 1) * RECIPE_PAGE_SIZE
    return recipeRows.slice(start, start + RECIPE_PAGE_SIZE)
  }, [boundedRecipePage, recipeRows])

  useEffect(() => {
    setRecipePage(1)
  }, [
    currentProgress,
    normalizedRecipeQuery,
    recipeIngredientCountFilter,
    recipeIngredientSequenceFilter,
    recipeConfirmedEffectFilter,
    recipePossibleEffectFilter,
    recipePriceFilter,
    recipeSourceFilter,
  ])

  useEffect(() => {
    if (recipePage > recipePageCount) {
      setRecipePage(recipePageCount)
    }
  }, [recipePage, recipePageCount])

  function updateProgress(value: ProgressMilestoneId) {
    setCurrentProgress(value)
    writeCurrentProgress(window.localStorage, value)
  }

  function updateSatisfaction(villageId: VillageId, value: number) {
    setSatisfactionByVillage((current) => {
      const next = withSatisfactionUpdate(current, villageId, value)
      writeSatisfactionByVillage(window.localStorage, next)
      return next
    })
  }

  function toggleCustomerSort(key: CustomerSortKey) {
    if (customerSortKey === key) {
      setCustomerSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setCustomerSortKey(key)
    setCustomerSortDirection(key === 'bestPrice' ? 'desc' : 'asc')
  }

  function toggleRecipeSort(key: RecipeSortKey) {
    if (recipeSortKey === key) {
      setRecipeSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setRecipeSortKey(key)
    setRecipeSortDirection(key === 'salePrice' ? 'desc' : 'asc')
  }

  function toggleSuppliedToday(customerId: string) {
    setSuppliedCustomerIds((current) => {
      const next = current.includes(customerId)
        ? current.filter((id) => id !== customerId)
        : [...current, customerId]

      writeSuppliedCustomerIds(window.localStorage, next)
      return next
    })
  }

  function resetSuppliedToday() {
    setSuppliedCustomerIds([])
    writeSuppliedCustomerIds(window.localStorage, [])
  }

  function toggleFormalCustomer(customerId: string) {
    setFormalCustomerIds((current) => {
      const next = current.includes(customerId)
        ? current.filter((id) => id !== customerId)
        : [...current, customerId]

      writeFormalCustomerIds(window.localStorage, next)
      return next
    })
  }

  function addComparisonCustomer(customerId: string) {
    setComparisonCustomerIds((current) =>
      current.includes(customerId) ? current : [...current, customerId],
    )
  }

  function removeComparisonCustomer(customerId: string) {
    setComparisonCustomerIds((current) =>
      current.filter((id) => id !== customerId),
    )
  }

  function toggleComparisonCustomer(customerId: string) {
    setComparisonCustomerIds((current) =>
      current.includes(customerId)
        ? current.filter((id) => id !== customerId)
        : [...current, customerId],
    )
  }

  function clearComparisonCustomers() {
    setComparisonCustomerIds([])
  }

  function clearCustomerResearchFilters() {
    setCustomerVillageFilter(null)
    setCustomerPreferenceIngredientFilter(null)
    setCustomerPreferenceEffectFilter(null)
    setCustomerPreferenceMode('all')
  }

  function clearRecipeResearchFilters() {
    setRecipeIngredientCountFilter(null)
    setRecipeIngredientSequenceFilter([])
    setRecipeConfirmedEffectFilter(null)
    setRecipePossibleEffectFilter(null)
    setRecipeSourceFilter('all')
    setRecipePriceFilter('all')
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Medieval Juice Crafter</p>
        <h1>果汁攻略規劃器</h1>
        <p className="lede">快速查顧客、配方與目前能完全滿足的飲料。</p>
      </header>

      <section className="progress-panel" aria-label="目前進度">
        <div className="progress-settings">
          <label>
            <span>目前主線進度</span>
            <select
              value={currentProgress}
              onChange={(event) =>
                updateProgress(event.target.value as ProgressMilestoneId)
              }
            >
              {progressMilestones.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <SatisfactionFields
            villageDefinitions={villages}
            currentProgress={currentProgress}
            satisfactionByVillage={satisfactionByVillage}
            onSatisfactionChange={updateSatisfaction}
          />
        </div>

        <div className="progress-summary">
          <div className="progress-summary-heading">
            <strong>正式顧客</strong>
            <span>依目前主線進度顯示已解鎖地區</span>
          </div>
          <div className="progress-stat-grid">
            <FormalCustomerStats
              villageDefinitions={villages}
              currentProgress={currentProgress}
              customerDefinitions={customers}
              formalCustomerIds={formalCustomerIds}
            />
          </div>
        </div>
      </section>

      {(tab === 'customers' || tab === 'recipes') && (
        <SearchPanel
          initialQuery={query}
          onQueryChange={setQuery}
        />
      )}

      <nav className="tabs" aria-label="資料類型">
        <button
          type="button"
          className={tab === 'customers' ? 'active' : ''}
          onClick={() => setTab('customers')}
        >
          顧客
          <span>{customerRows.length}</span>
        </button>
        <button
          type="button"
          className={tab === 'recipes' ? 'active' : ''}
          onClick={() => setTab('recipes')}
        >
          配方
          <span>{recipeRows.length}</span>
        </button>
        <button
          type="button"
          className={tab === 'tools' ? 'active' : ''}
          onClick={() => setTab('tools')}
        >
          配方工具
        </button>
        <button
          type="button"
          className={tab === 'optimizer' ? 'active' : ''}
          onClick={() => setTab('optimizer')}
        >
          批次規劃
        </button>
      </nav>

      {tab === 'customers' ? (
        <>
          <section className="research-filter-panel" aria-label="顧客篩選">
            <div className="research-filter-heading">
              <div>
                <strong>顧客篩選</strong>
                <span>村落固定限制範圍；「全部／任一」只套用喜好條件。</span>
              </div>
              <button
                type="button"
                className="research-filter-clear"
                onClick={clearCustomerResearchFilters}
              >
                清除篩選
              </button>
            </div>
            <div className="research-filter-grid customer-research-filters">
              <label>
                <span>村落</span>
                <select
                  value={customerVillageFilter ?? ''}
                  onChange={(event) =>
                    setCustomerVillageFilter(
                      (event.target.value || null) as VillageId | null,
                    )
                  }
                >
                  <option value="">全部村落</option>
                  <option value="east-harbor">東港村</option>
                  <option value="tranquil-fountain">靜謐噴泉</option>
                </select>
              </label>
              <label>
                <span>喜好原料</span>
                <select
                  value={customerPreferenceIngredientFilter ?? ''}
                  onChange={(event) =>
                    setCustomerPreferenceIngredientFilter(
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">不限</option>
                  {customerPreferenceIngredientOptions.map((name) => (
                    <option value={name} key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>喜好特性</span>
                <select
                  value={customerPreferenceEffectFilter ?? ''}
                  onChange={(event) =>
                    setCustomerPreferenceEffectFilter(
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">不限</option>
                  {customerPreferenceEffectOptions.map((name) => (
                    <option value={name} key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>喜好條件</span>
                <select
                  value={customerPreferenceMode}
                  onChange={(event) =>
                    setCustomerPreferenceMode(
                      event.target.value as FilterMatchMode,
                    )
                  }
                >
                  <option value="all">全部符合</option>
                  <option value="any">任一符合</option>
                </select>
              </label>
            </div>
            <p className="research-filter-summary">
              目前顯示 {customerRows.length} 位顧客。
            </p>
          </section>

          <div className="customer-toolbar" aria-label="顧客顯示範圍">
            <button
              type="button"
              className={customerVisibility === 'available' ? 'active' : ''}
              onClick={() => setCustomerVisibility('available')}
            >
              滿意度門檻已達
            </button>
            <button
              type="button"
              className={customerVisibility === 'all' ? 'active' : ''}
              onClick={() => setCustomerVisibility('all')}
            >
              全部顧客
            </button>
            <button
              type="button"
              className={
                customerRecommendationCostMode === 'minimum'
                  ? 'active'
                  : ''
              }
              aria-pressed={customerRecommendationCostMode === 'minimum'}
              onClick={() => setCustomerRecommendationCostMode('minimum')}
            >
              最佳：最低成本
            </button>
            <button
              type="button"
              className={
                customerRecommendationCostMode === 'maximum'
                  ? 'active'
                  : ''
              }
              aria-pressed={customerRecommendationCostMode === 'maximum'}
              onClick={() => setCustomerRecommendationCostMode('maximum')}
            >
              最佳：最高成本
            </button>
            <button
              type="button"
              className={showSuppliedToday ? 'active' : ''}
              aria-pressed={showSuppliedToday}
              onClick={() => setShowSuppliedToday((current) => !current)}
            >
              {showSuppliedToday ? '隱藏已供應' : '顯示已供應'}
            </button>
            <button
              type="button"
              className="reset-supply-button"
              disabled={suppliedCustomerIds.length === 0}
              onClick={resetSuppliedToday}
            >
              重置今日供應
            </button>
            <span>
              今日已供應 {suppliedCustomerIds.length} 人
              {satisfactionFieldsAtProgress(
                villages,
                currentProgress,
                satisfactionByVillage,
              ).map(
                (village) =>
                  ` · ${village.name}滿意度 ${village.value}`,
              )}
            </span>
          </div>

          <section className="table-list customer-table" aria-label="顧客">
          <div className="table-head customer-columns">
            <SortableHeader
              label="顧客"
              active={customerSortKey === 'name'}
              direction={customerSortDirection}
              onClick={() => toggleCustomerSort('name')}
            />
            <span>村子</span>
            <span>解鎖滿意度</span>
            <span>喜好</span>
            <SortableHeader
              label="最佳完全匹配"
              active={customerSortKey === 'bestMatch'}
              direction={customerSortDirection}
              onClick={() => toggleCustomerSort('bestMatch')}
            />
            <SortableHeader
              label="售價"
              active={customerSortKey === 'bestPrice'}
              direction={customerSortDirection}
              alignEnd
              onClick={() => toggleCustomerSort('bestPrice')}
            />
            <span className="align-end">今日已供應</span>
          </div>

          {customerRows.map(
            ({ customer, matches, unlocked, recommendations }) => (
              <CustomerRow
                key={customer.id}
                customer={customer}
                matches={matches}
                recommendations={recommendations}
                recommendationCostMode={customerRecommendationCostMode}
                unlocked={unlocked}
                formal={isFormalCustomer(customer.id, formalCustomerIds)}
                suppliedToday={suppliedCustomerIds.includes(customer.id)}
                comparisonSelected={comparisonCustomerIds.includes(customer.id)}
                onToggleFormal={() => toggleFormalCustomer(customer.id)}
                onToggleSupplied={() => toggleSuppliedToday(customer.id)}
                onToggleComparison={() => toggleComparisonCustomer(customer.id)}
              />
            ),
          )}
          </section>
        </>
      ) : tab === 'recipes' ? (
        <>
          <section className="research-filter-panel" aria-label="配方篩選">
            <div className="research-filter-heading">
              <div>
                <strong>配方篩選</strong>
                <span>「確定特性」與歧義中的「可能特性」分開判定。</span>
              </div>
              <button
                type="button"
                className="research-filter-clear"
                onClick={clearRecipeResearchFilters}
              >
                清除篩選
              </button>
            </div>
            <div
              className="recipe-sequence-filter"
              aria-label="連續原料順序篩選"
            >
              <div className="recipe-sequence-filter-heading">
                <div>
                  <strong>連續原料順序</strong>
                  <span>
                    只匹配相鄰且順序完全一致的片段；例如「檸檬 → 薄荷」不會匹配「檸檬 → 糖 → 薄荷」。
                  </span>
                </div>
                {recipeIngredientSequenceFilter.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setRecipeIngredientSequenceFilter([])}
                  >
                    清除順序
                  </button>
                )}
              </div>
              <div className="recipe-sequence-selected">
                {recipeIngredientSequenceFilter.length === 0 ? (
                  <span className="recipe-sequence-empty">
                    尚未指定原料順序
                  </span>
                ) : (
                  recipeIngredientSequenceFilter.map(
                    (ingredientId, index) => (
                      <span
                        className="recipe-sequence-token"
                        key={ingredientId + '-' + index}
                      >
                        {index > 0 && <b aria-hidden="true">→</b>}
                        <button
                          type="button"
                          title="移除這個位置"
                          onClick={() =>
                            setRecipeIngredientSequenceFilter((current) =>
                              current.filter(
                                (_, currentIndex) => currentIndex !== index,
                              ),
                            )
                          }
                        >
                          {ingredientNameById.get(ingredientId) ?? ingredientId}
                          <span aria-hidden="true"> ×</span>
                        </button>
                      </span>
                    ),
                  )
                )}
              </div>
              <div
                className="recipe-sequence-options"
                aria-label="加入原料"
              >
                {recipeSequenceIngredientOptions.map((ingredient) => (
                  <button
                    type="button"
                    key={ingredient.id}
                    onClick={() =>
                      setRecipeIngredientSequenceFilter((current) => [
                        ...current,
                        ingredient.id,
                      ])
                    }
                  >
                    + {ingredient.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="research-filter-grid recipe-research-filters">
              <label>
                <span>原料總數</span>
                <select
                  value={recipeIngredientCountFilter ?? ''}
                  onChange={(event) =>
                    setRecipeIngredientCountFilter(
                      event.target.value
                        ? Number(event.target.value)
                        : null,
                    )
                  }
                >
                  <option value="">不限</option>
                  {recipeIngredientCountOptions.map((count) => (
                    <option value={count} key={count}>{count} 項</option>
                  ))}
                </select>
              </label>
              <label>
                <span>確定成品特性</span>
                <select
                  value={recipeConfirmedEffectFilter ?? ''}
                  onChange={(event) =>
                    setRecipeConfirmedEffectFilter(
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">不限</option>
                  {recipeConfirmedEffectOptions.map((name) => (
                    <option value={name} key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>可能特性（歧義）</span>
                <select
                  value={recipePossibleEffectFilter ?? ''}
                  onChange={(event) =>
                    setRecipePossibleEffectFilter(
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">不限</option>
                  {recipePossibleEffectOptions.map((name) => (
                    <option value={name} key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>來源</span>
                <select
                  value={recipeSourceFilter}
                  onChange={(event) =>
                    setRecipeSourceFilter(
                      event.target.value as RecipeSourceFilter,
                    )
                  }
                >
                  <option value="all">全部來源</option>
                  <option value="observed">實測</option>
                  <option value="saved">已保存</option>
                  <option value="computed">安全推導</option>
                  <option value="ambiguous-computed">歧義推導</option>
                </select>
              </label>
              <label>
                <span>售價</span>
                <select
                  value={recipePriceFilter}
                  onChange={(event) =>
                    setRecipePriceFilter(
                      event.target.value as RecipePriceFilter,
                    )
                  }
                >
                  <option value="all">全部</option>
                  <option value="known">已有實測售價</option>
                  <option value="unknown">售價未知</option>
                </select>
              </label>
            </div>
            <p className="research-filter-summary">
              {recipeIngredientSequenceFilter.length > 0 && (
                <>
                  連續順序「
                  {recipeIngredientSequenceFilter
                    .map(
                      (ingredientId) =>
                        ingredientNameById.get(ingredientId) ?? ingredientId,
                    )
                    .join(' → ')}
                  」 ·{' '}
                </>
              )}
              符合 {recipeRows.length} 筆 · 每頁最多 {RECIPE_PAGE_SIZE} 筆
            </p>
          </section>

          <section className="table-list recipe-table" aria-label="配方">
            <div className="table-head recipe-columns">
              <SortableHeader
                label="配方"
                active={recipeSortKey === 'name'}
                direction={recipeSortDirection}
                onClick={() => toggleRecipeSort('name')}
              />
              <span>原料</span>
              <span>成品特性</span>
              <span>原料成本</span>
              <SortableHeader
                label="售價"
                active={recipeSortKey === 'salePrice'}
                direction={recipeSortDirection}
                alignEnd
                onClick={() => toggleRecipeSort('salePrice')}
              />
            </div>

            {pagedRecipeRows.map((entry) => (
              <MemoizedRecipeRow
                key={entry.id}
                entry={entry}
                currentProgress={currentProgress}
                satisfactionByVillage={deferredSatisfactionByVillage}
              />
            ))}
          </section>

          <nav className="recipe-pagination" aria-label="配方換頁">
            <button
              type="button"
              disabled={boundedRecipePage <= 1}
              onClick={() =>
                setRecipePage((current) => Math.max(1, current - 1))
              }
            >
              上一頁
            </button>
            <label>
              <span>第</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={recipePageCount}
                value={boundedRecipePage}
                onChange={(event) =>
                  setRecipePage(
                    Math.min(
                      recipePageCount,
                      Math.max(
                        1,
                        Math.floor(Number(event.target.value) || 1),
                      ),
                    ),
                  )
                }
              />
              <span>/ {recipePageCount} 頁</span>
            </label>
            <button
              type="button"
              disabled={boundedRecipePage >= recipePageCount}
              onClick={() =>
                setRecipePage((current) =>
                  Math.min(recipePageCount, current + 1),
                )
              }
            >
              下一頁
            </button>
          </nav>
        </>
      ) : tab === 'tools' ? (
        <RecipeTools
          currentProgress={currentProgress}
          satisfactionByVillage={deferredSatisfactionByVillage}
          savedRecipes={savedRecipes}
          comparisonCustomerIds={comparisonCustomerIds}
          onSavedRecipesChange={setSavedRecipes}
          onAddComparisonCustomer={addComparisonCustomer}
          onRemoveComparisonCustomer={removeComparisonCustomer}
          onClearComparisonCustomers={clearComparisonCustomers}
        />
      ) : null}

      <div hidden={tab !== 'optimizer'}>
        <MemoizedOptimizerTools
          currentProgress={currentProgress}
          satisfactionByVillage={deferredSatisfactionByVillage}
          suppliedCustomerIds={suppliedCustomerIds}
          formalCustomerIds={formalCustomerIds}
          recipeCandidatePool={recipeCandidatePool}
          onSuppliedCustomerIdsCommitted={setSuppliedCustomerIds}
        />
      </div>

      {comparisonCustomerIds.length > 0 && (
        <ComparisonDock
          customers={comparisonCustomerIds.flatMap((customerId) => {
            const customer = customers.find((item) => item.id === customerId)
            return customer ? [customer] : []
          })}
          onOpenTools={() => setTab('tools')}
          onRemove={removeComparisonCustomer}
          onClear={clearComparisonCustomers}
        />
      )}

      <footer>
        預測配方不自行推導售價；同分 cutoff 未確認時不宣稱完全匹配。
      </footer>
    </main>
  )
}

function SearchPanel({
  initialQuery,
  onQueryChange,
}: {
  initialQuery: string
  onQueryChange: (query: string) => void
}) {
  const [inputValue, setInputValue] = useState(initialQuery)

  function updateQuery(value: string) {
    setInputValue(value)
    startTransition(() => {
      onQueryChange(value)
    })
  }

  return (
    <section className="search-panel">
      <input
        aria-label="搜尋"
        placeholder="搜尋顧客、職業、配方、原料、特性……"
        value={inputValue}
        onChange={(event) => updateQuery(event.target.value)}
      />
      {inputValue && (
        <button
          className="clear-button"
          type="button"
          onClick={() => updateQuery('')}
        >
          清除
        </button>
      )}
    </section>
  )
}

function SortableHeader({
  label,
  active,
  direction,
  alignEnd = false,
  onClick,
}: {
  label: string
  active: boolean
  direction: SortDirection
  alignEnd?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`header-sort${active ? ' active' : ''}${alignEnd ? ' align-end' : ''}`}
      onClick={onClick}
      aria-label={
        active
          ? `${label}，目前${direction === 'asc' ? '升冪' : '降冪'}；點擊切換排序方向`
          : `依${label}排序`
      }
    >
      <span>{label}</span>
      {active && <span className="sort-indicator">{direction === 'asc' ? '↑' : '↓'}</span>}
    </button>
  )
}

function CustomerRow({
  customer,
  matches,
  recommendations,
  recommendationCostMode,
  unlocked,
  formal,
  suppliedToday,
  comparisonSelected,
  onToggleFormal,
  onToggleSupplied,
  onToggleComparison,
}: {
  customer: Customer
  matches: RecipeCandidate[]
  recommendations: CustomerRecipeRecommendations
  recommendationCostMode: RecommendationCostMode
  unlocked: boolean
  formal: boolean
  suppliedToday: boolean
  comparisonSelected: boolean
  onToggleFormal: () => void
  onToggleSupplied: () => void
  onToggleComparison: () => void
}) {
  const bestMatch = matches[0]
  const visibleMatches = matches.slice(0, 8)
  const remainingMatches = matches.slice(8)
  const preferencesKnown = customer.preferences !== null

  const rowClassName = [
    'table-row',
    unlocked ? '' : 'locked-row',
    suppliedToday ? 'supplied-row' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <details className={rowClassName}>
      <summary className="customer-columns">
        <div className="primary-cell">
          <strong>{customer.name}</strong>
          <span className="cell-secondary">{customer.occupation}</span>
          <div className="customer-quick-actions">
            <FormalToggle formal={formal} onToggle={onToggleFormal} />
            <CompareToggle
              selected={comparisonSelected}
              onToggle={onToggleComparison}
            />
          </div>
          <span className="mobile-customer-meta">
            {villageNames[customer.villageId]} · {customer.satisfactionRequired > 0
              ? `解鎖 ${customer.satisfactionRequired}`
              : '無滿意度門檻'}
          </span>
          <SupplyToggle
            mobile
            supplied={suppliedToday}
            onToggle={onToggleSupplied}
          />
        </div>

        <div className="village-cell">{villageNames[customer.villageId]}</div>

        <div className="unlock-cell">
          {customer.satisfactionRequired > 0 ? (
            <span className={unlocked ? 'status unlocked' : 'status locked'}>
              {unlocked ? `${customer.satisfactionRequired} ✓` : customer.satisfactionRequired}
            </span>
          ) : (
            <span className="no-threshold">—</span>
          )}
        </div>

        <div className="preferences-cell">
          {customer.preferences
            ? customer.preferences.map((preference) => preference.value).join('・')
            : <span className="muted">未知（？）</span>}
        </div>

        <div className="best-match-cell">
          {!preferencesKnown ? (
            <span className="muted">喜好未知</span>
          ) : bestMatch ? (
            <>
              <span>{formatRecipeDisplayName(bestMatch.name)}</span>
              <RecommendationCompact
                recommendation={recommendations.allowComputed}
              />
            </>
          ) : (
            <span className="muted">無完全匹配</span>
          )}
        </div>

        <div className="price-cell align-end">
          {bestMatch
            ? bestMatch.salePrice === null
              ? '未知'
              : formatMoney(bestMatch.salePrice)
            : '—'}
        </div>

        <SupplyToggle supplied={suppliedToday} onToggle={onToggleSupplied} />
      </summary>

      <div className="row-details">
        <div className="detail-line">
          <span className="detail-label">村子</span>
          <span>{villageNames[customer.villageId]}</span>
        </div>

        {customer.satisfactionRequired > 0 ? (
          <div className="detail-line">
            <span className="detail-label">解鎖滿意度</span>
            <span className={unlocked ? 'status unlocked' : 'status locked'}>
              {unlocked ? `${customer.satisfactionRequired}（已達）` : customer.satisfactionRequired}
            </span>
          </div>
        ) : (
          <div className="detail-line">
            <span className="detail-label">解鎖滿意度</span>
            <span>無已知門檻</span>
          </div>
        )}

        <div className="detail-line">
          <span className="detail-label">顧客狀態</span>
          <span>{formal ? '正式顧客' : '潛在顧客'}</span>
        </div>

        {customer.preferences ? (
          <TagGroup
            title="喜好"
            tags={customer.preferences.map((preference) => preference.value)}
          />
        ) : (
          <div className="detail-line">
            <span className="detail-label">喜好</span>
            <span>未知（？）</span>
          </div>
        )}

        <RecommendationDetails
          formal={formal}
          recommendations={recommendations}
          costMode={recommendationCostMode}
        />

        <div className="match-list">
          <div className="section-title">
            <strong>完全滿足配方</strong>
            <span>{preferencesKnown ? `${matches.length} 種` : '待確認'}</span>
          </div>
          {!preferencesKnown ? (
            <p className="muted">喜好尚未確認，無法判斷完全匹配配方。</p>
          ) : matches.length > 0 ? (
            <>
              <ol>
                {visibleMatches.map((recipe) => (
                  <FullMatchRecipeItem key={recipe.id} recipe={recipe} />
                ))}
              </ol>
              {remainingMatches.length > 0 && (
                <details className="match-list-more">
                  <summary>顯示其餘 {remainingMatches.length} 種</summary>
                  <ol start={visibleMatches.length + 1}>
                    {remainingMatches.map((recipe) => (
                      <FullMatchRecipeItem
                        key={recipe.id}
                        recipe={recipe}
                      />
                    ))}
                  </ol>
                </details>
              )}
            </>
          ) : (
            <p className="muted">目前主線進度沒有能完全滿足所有喜好的已知配方。</p>
          )}
        </div>

        {customer.schedule && (
          <div className="schedule">
            {customer.schedule.map((entry, index) => (
              <span key={`${entry.type}-${index}`} title={entry.note}>
                {scheduleLabels[entry.type]} {entry.approxTime}
              </span>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}

function FormalToggle({
  formal,
  onToggle,
}: {
  formal: boolean
  onToggle: () => void
}) {
  return (
    <label
      className={`formal-check ${formal ? 'formal' : 'potential'}`}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={formal}
        onChange={onToggle}
        onClick={(event) => event.stopPropagation()}
      />
      <span>{formal ? '正式' : '潛在'}</span>
    </label>
  )
}

function CompareToggle({
  selected,
  onToggle,
}: {
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`comparison-toggle${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
    >
      {selected ? '✓ 比較中' : '＋ 比較'}
    </button>
  )
}

function SupplyToggle({
  supplied,
  onToggle,
  mobile = false,
}: {
  supplied: boolean
  onToggle: () => void
  mobile?: boolean
}) {
  return (
    <label
      className={`supply-check${mobile ? ' mobile' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={supplied}
        onChange={onToggle}
        onClick={(event) => event.stopPropagation()}
      />
      <span>{supplied ? '已供應' : '未供應'}</span>
    </label>
  )
}

function FullMatchRecipeItem({
  recipe,
}: {
  recipe: RecipeCandidate
}) {
  const cost = calculateRecipeIngredientCost(recipe)

  return (
    <li>
      <span>{formatRecipeDisplayName(recipe.name)}</span>
      <strong>
        {formatRecipeCost(cost)} ·{' '}
        {recipe.salePrice === null
          ? '售價未知'
          : '售價 ' + formatMoney(recipe.salePrice)}
      </strong>
    </li>
  )
}

function RecommendationCompact({
  recommendation,
}: {
  recommendation: CustomerRecipeRecommendations['allowComputed']
}) {
  if (!recommendation) return null

  const sources = new Set(
    recommendation.candidates.map(({ candidate }) => candidate.source),
  )
  const sourceLabel =
    sources.size > 1
      ? '實測／預測'
      : sources.has('computed')
        ? '預測'
        : '實測'
  const costLabel =
    recommendation.costMode === 'minimum' ? '最低成本' : '最高成本'
  const recipeLabel =
    recommendation.candidates.length === 1
      ? formatRecipeDisplayName(
          recommendation.candidates[0].candidate.name,
        )
      : `${recommendation.candidates.length} 種同價${recommendation.costMode === 'minimum' ? '最低' : '最高'}`

  return (
    <span className="recommendation-compact">
      {costLabel}：{recipeLabel} · {formatMoney(recommendation.batchIngredientCost)}／批 ·{' '}
      {sourceLabel}
    </span>
  )
}

function RecommendationDetails({
  formal,
  recommendations,
  costMode,
}: {
  formal: boolean
  recommendations: CustomerRecipeRecommendations
  costMode: RecommendationCostMode
}) {
  const title = formal ? '最佳完全匹配' : '最佳試喝建議'
  const costLabel = costMode === 'minimum' ? '最低成本' : '最高成本'

  return (
    <div className="recommendation-box">
      <div className="section-title">
        <strong>{title}</strong>
        <span>{costLabel}</span>
      </div>
      <RecommendationLine
        label={`已實測${costLabel}`}
        recommendation={recommendations.observedOnly}
      />
      <RecommendationLine
        label={`含預測${costLabel}`}
        recommendation={recommendations.allowComputed}
      />
    </div>
  )
}

function RecommendationLine({
  label,
  recommendation,
}: {
  label: string
  recommendation: CustomerRecipeRecommendations['observedOnly']
}) {
  if (!recommendation) {
    return (
      <div className="recommendation-line">
        <span>{label}</span>
        <span className="muted">目前沒有可靠 full match</span>
      </div>
    )
  }

  return (
    <div className="recommendation-line">
      <span>{label}</span>
      <div>
        <strong>
          {recommendation.candidates
            .map(({ candidate }) =>
              formatRecipeDisplayName(candidate.name),
            )
            .join('、')}
        </strong>
        <small>
          {formatRecipeIngredientCost(
            recommendation.batchIngredientCost,
            recommendation.unitIngredientCost,
          )}
        </small>
      </div>
    </div>
  )
}

function formatRecipeCost(cost: RecipeIngredientCost): string {
  return formatRecipeIngredientCost(
    cost.batchIngredientCost,
    cost.unitIngredientCost,
  )
}

export function ComparisonDock({
  customers: selectedCustomers,
  onOpenTools,
  onRemove,
  onClear,
}: {
  customers: Customer[]
  onOpenTools: () => void
  onRemove: (customerId: string) => void
  onClear: () => void
}) {
  return (
    <aside className="comparison-dock" aria-label="比較顧客">
      <div className="comparison-dock-heading">
        <strong>比較顧客 {selectedCustomers.length} 人</strong>
        <button type="button" onClick={onClear}>全部清除</button>
      </div>
      <div className="comparison-dock-list">
        {selectedCustomers.map((customer) => (
          <button
            type="button"
            key={customer.id}
            onClick={() => onRemove(customer.id)}
            title="點擊移除"
          >
            {customer.name}（{customer.occupation}） ×
          </button>
        ))}
      </div>
      <button
        type="button"
        className="comparison-dock-open"
        onClick={onOpenTools}
      >
        前往配方工具比較
      </button>
    </aside>
  )
}

function RecipeRow({
  entry,
  currentProgress,
  satisfactionByVillage,
}: {
  entry: RecipeCandidatePoolEntry
  currentProgress: ProgressMilestoneId
  satisfactionByVillage: SatisfactionByVillage
}) {
  const recipe = entry.candidate
  const cost = calculateRecipeIngredientCost(recipe)
  const matchingCustomers = customers
    .filter((customer) =>
      customerIsUnlocked(customer, currentProgress, satisfactionByVillage),
    )
    .filter((customer) => recipeCandidateMatchesCustomer(recipe, customer))

  return (
    <details className="table-row">
      <summary className="recipe-columns">
        <div className="primary-cell">
          <strong>{formatRecipeDisplayName(recipe.name)}</strong>
          <span className="cell-secondary">
            {progressMilestoneLabels[recipe.unlockedAt]} ·{' '}
            {recipeEntrySourceLabel(entry)}
          </span>
        </div>

        <div>{formatRecipeSequence(recipe.ingredients)}</div>

        <div className="effects-cell">
          {recipe.effects.map(formatEffect).join('・')}
          {recipe.effectAmbiguity && (
            <span className="muted">
              {recipe.effects.length > 0 ? '・' : ''}同分候選待確認
            </span>
          )}
        </div>

        <div className="cost-cell">{formatRecipeCost(cost)}</div>

        <div className="price-cell align-end">
          {formatMoney(recipe.salePrice)}
        </div>
      </summary>

      <div className="row-details">
        <TagGroup title="原料順序" tags={[formatRecipeSequence(recipe.ingredients)]} />
        <TagGroup
          title={
            recipe.source === 'observed'
              ? '成品特性（實測）'
              : '成品特性（預測・無同分歧義）'
          }
          tags={recipe.effects.map(formatEffect)}
        />
        {recipe.effectAmbiguity && (
          <TagGroup
            title={`同分候選（剩 ${recipe.effectAmbiguity.remainingSlots} 格）`}
            tags={recipe.effectAmbiguity.candidates.map(formatEffect)}
          />
        )}
        <TagGroup title="所需設備" tags={recipe.equipment} />
        <div className="detail-line">
          <span className="detail-label">原料成本</span>
          <span>{formatRecipeCost(cost)}</span>
        </div>

        <div className="match-list">
          <div className="section-title">
            <strong>可完全滿足顧客</strong>
            <span>
              {recipe.effectAmbiguity ? '待確認' : `${matchingCustomers.length} 人`}
            </span>
          </div>
          <p className="customer-names">
            {recipe.effectAmbiguity
              ? '此預測存在未確認的同分 cutoff，暫不參與完全匹配判定。'
              : matchingCustomers.length
                ? matchingCustomers
                    .map((customer) => `${customer.name}(${customer.occupation})`)
                    .join('、')
                : '目前進度與滿意度下沒有能完全滿足的已知顧客。'}
          </p>
        </div>
      </div>
    </details>
  )
}

function TagGroup({ title, tags }: { title: string; tags: string[] }) {
  return (
    <div className="tag-group">
      <span className="tag-label">{title}</span>
      <div className="tags">
        {tags.map((tag) => (
          <span className="tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  )
}

export default App
