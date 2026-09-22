import { useEffect, useMemo, useState } from 'react'
import OptimizerTools from './OptimizerTools'
import RecipeTools from './RecipeTools'
import { customers } from './data/customers'
import { progressMilestoneLabels, progressMilestones } from './data/progress'
import { villageNames } from './data/villages'
import {
  customerIsUnlocked,
  customerVillageIsAvailable,
  villageIsAvailable,
} from './domain/availability'
import {
  filterSuppliedCustomerRows,
  sortCustomerRows,
  type CustomerSortKey,
  type SortDirection,
} from './domain/customerList'
import {
  customerRecipeRecommendationsFromSearch,
  type CustomerRecipeRecommendations,
} from './domain/customerRecommendation'
import {
  countFormalCustomersByVillage,
  isFormalCustomer,
} from './domain/customerState'
import {
  matchingRecipeCandidatesForCustomer,
  recipeCandidateMatchesCustomer,
} from './domain/matching'
import {
  buildRecipeCandidatePool,
  recipeCandidatesInCurrentSearchScope,
} from './domain/recipeCandidatePool'
import { searchRecipeCandidatesForCustomer } from './domain/recipeSearch'
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
type RecipeSourceFilter = 'all' | 'observed' | 'computed'
type RecipePriceFilter = 'all' | 'known' | 'unknown'
type CustomerVisibility = 'available' | 'all'

const RECIPE_PAGE_SIZE = 50

const scheduleLabels = {
  leave_home: '出家門',
  outside_village_by: '已在村外',
  return_village: '回村',
} as const

function formatEffect(effect: EffectValue) {
  return `${effect.name}（${effect.value}）`
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
  const [recipeSortKey, setRecipeSortKey] = useState<RecipeSortKey>('salePrice')
  const [recipeSortDirection, setRecipeSortDirection] =
    useState<SortDirection>('desc')
  const [recipeSourceFilter, setRecipeSourceFilter] =
    useState<RecipeSourceFilter>('all')
  const [recipePriceFilter, setRecipePriceFilter] =
    useState<RecipePriceFilter>('all')
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

  const normalizedQuery = query.trim().toLocaleLowerCase('zh-Hant')
  const tranquilFountainAvailable = villageIsAvailable(
    'tranquil-fountain',
    currentProgress,
  )
  const recipeCandidatePool = useMemo(
    () => buildRecipeCandidatePool(currentProgress, savedRecipes),
    [currentProgress, savedRecipes],
  )
  const recipeCandidates = useMemo(
    () => recipeCandidatesInCurrentSearchScope(recipeCandidatePool),
    [recipeCandidatePool],
  )
  const recipeOrder = useMemo(
    () =>
      new Map(
        recipeCandidates.map((candidate, index) => [candidate.id, index]),
      ),
    [recipeCandidates],
  )
  const eastHarborFormalCount = countFormalCustomersByVillage(
    customers,
    formalCustomerIds,
    'east-harbor',
  )
  const tranquilFountainFormalCount = countFormalCustomersByVillage(
    customers,
    formalCustomerIds,
    'tranquil-fountain',
  )

  const customerRows = useMemo(() => {
    const searchesByCustomerId = new Map(
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

    const rows = customers
      .filter((customer) => customerVillageIsAvailable(customer, currentProgress))
      .map((customer) => {
        const searches = searchesByCustomerId.get(customer.id)
        const candidates = searches?.allowComputed.candidates ?? []

        return {
          customer,
          unlocked: customerIsUnlocked(
            customer,
            currentProgress,
            satisfactionByVillage,
          ),
          matches: matchingRecipeCandidatesForCustomer(
            [...candidates],
            customer,
          ),
        }
      })
      .filter(({ unlocked }) => customerVisibility === 'all' || unlocked)

    const suppliedFilteredRows = filterSuppliedCustomerRows(
      rows,
      suppliedCustomerIds,
      showSuppliedToday,
    )

    const searchedRows = suppliedFilteredRows.filter(({ customer, matches }) => {
      if (!normalizedQuery) return true
      const haystack = [
        customer.name,
        customer.occupation,
        ...(customer.preferences ?? []).map((preference) => preference.value),
        ...matches.map((recipe) => recipe.name),
      ]
        .join(' ')
        .toLocaleLowerCase('zh-Hant')
      return haystack.includes(normalizedQuery)
    })

    return sortCustomerRows(
      searchedRows,
      customerSortKey,
      customerSortDirection,
      recipeOrder,
    ).map((row) => {
      const searches = searchesByCustomerId.get(row.customer.id)
      return {
        ...row,
        recommendations: customerRecipeRecommendationsFromSearch(
          searches?.observedOnly.candidates ?? [],
          searches?.allowComputed.candidates ?? [],
          row.customer,
        ),
      }
    })
  }, [
    normalizedQuery,
    currentProgress,
    satisfactionByVillage,
    recipeCandidatePool,
    recipeOrder,
    customerVisibility,
    showSuppliedToday,
    suppliedCustomerIds,
    customerSortDirection,
    customerSortKey,
  ])

  const recipeRows = useMemo(() => {
    const rows = recipeCandidates
      .filter((recipe) => {
        if (
          recipeSourceFilter !== 'all' &&
          recipe.source !== recipeSourceFilter
        ) {
          return false
        }
        if (
          recipePriceFilter === 'known' &&
          recipe.salePrice === null
        ) {
          return false
        }
        if (
          recipePriceFilter === 'unknown' &&
          recipe.salePrice !== null
        ) {
          return false
        }
        if (!normalizedQuery) return true
        return [
          recipe.name,
          ...recipe.ingredients,
          ...recipe.effects.map((effect) => effect.name),
          ...(recipe.effectAmbiguity?.candidates.map((effect) => effect.name) ?? []),
          ...recipe.equipment,
        ]
          .join(' ')
          .toLocaleLowerCase('zh-Hant')
          .includes(normalizedQuery)
      })

    const direction = recipeSortDirection === 'asc' ? 1 : -1

    return rows.sort((a, b) => {
      if (recipeSortKey === 'salePrice') {
        if (a.salePrice === null && b.salePrice === null) {
          return (
            ((recipeOrder.get(a.id) ?? 0) -
              (recipeOrder.get(b.id) ?? 0)) *
            direction
          )
        }
        if (a.salePrice === null) return 1
        if (b.salePrice === null) return -1
        return (
          (a.salePrice - b.salePrice) * direction ||
          (recipeOrder.get(a.id) ?? 0) - (recipeOrder.get(b.id) ?? 0)
        )
      }

      return a.name.localeCompare(b.name, 'zh-Hant') * direction
    })
  }, [
    normalizedQuery,
    recipeCandidates,
    recipeOrder,
    recipePriceFilter,
    recipeSortDirection,
    recipeSortKey,
    recipeSourceFilter,
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
    normalizedQuery,
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
    const normalized = Math.max(0, Math.floor(value || 0))
    setSatisfactionByVillage((current) => {
      const next = {
        ...current,
        [villageId]: normalized,
      }
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

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Medieval Juice Crafter</p>
        <h1>果汁攻略規劃器</h1>
        <p className="lede">快速查顧客、配方與目前能完全滿足的飲料。</p>
      </header>

      <section className="progress-panel" aria-label="目前進度">
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

        <label>
          <span>東港村顧客滿意度</span>
          <input
            inputMode="numeric"
            min={0}
            type="number"
            value={satisfactionByVillage['east-harbor']}
            onChange={(event) =>
              updateSatisfaction('east-harbor', Number(event.target.value))
            }
          />
        </label>

        {tranquilFountainAvailable && (
          <label>
            <span>靜謐噴泉顧客滿意度</span>
            <input
              inputMode="numeric"
              min={0}
              type="number"
              value={satisfactionByVillage['tranquil-fountain']}
              onChange={(event) =>
                updateSatisfaction(
                  'tranquil-fountain',
                  Number(event.target.value),
                )
              }
            />
          </label>
        )}

        <div className="progress-stat">
          <span>東港村正式顧客</span>
          <strong>{eastHarborFormalCount} 人</strong>
          <small>
            階段三 {Math.min(eastHarborFormalCount, 14)}/14 · 階段四{' '}
            {Math.min(eastHarborFormalCount, 17)}/17
          </small>
        </div>

        {tranquilFountainAvailable && (
          <div className="progress-stat">
            <span>靜謐噴泉正式顧客</span>
            <strong>{tranquilFountainFormalCount} 人</strong>
            <small>目前沒有已確認的正式顧客數主線門檻</small>
          </div>
        )}
      </section>

      {(tab === 'customers' || tab === 'recipes') && (
        <section className="search-panel">
          <input
            aria-label="搜尋"
            placeholder="搜尋顧客、職業、配方、原料、特性……"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <button
              className="clear-button"
              type="button"
              onClick={() => setQuery('')}
            >
              清除
            </button>
          )}
        </section>
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
              今日已供應 {suppliedCustomerIds.length} 人 · 東港村滿意度{' '}
              {satisfactionByVillage['east-harbor']}
              {tranquilFountainAvailable &&
                ` · 靜謐噴泉滿意度 ${satisfactionByVillage['tranquil-fountain']}`}
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
          <div className="recipe-toolbar" aria-label="配方篩選">
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
                <option value="all">全部</option>
                <option value="observed">實測</option>
                <option value="computed">預測</option>
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
            <span>
              符合 {recipeRows.length} 筆 · 每頁最多 {RECIPE_PAGE_SIZE} 筆
            </span>
          </div>

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

            {pagedRecipeRows.map((recipe) => (
              <RecipeRow
                key={recipe.id}
                recipe={recipe}
                currentProgress={currentProgress}
                satisfactionByVillage={satisfactionByVillage}
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
          satisfactionByVillage={satisfactionByVillage}
          savedRecipes={savedRecipes}
          comparisonCustomerIds={comparisonCustomerIds}
          onSavedRecipesChange={setSavedRecipes}
          onAddComparisonCustomer={addComparisonCustomer}
          onRemoveComparisonCustomer={removeComparisonCustomer}
          onClearComparisonCustomers={clearComparisonCustomers}
        />
      ) : null}

      <div hidden={tab !== 'optimizer'}>
        <OptimizerTools
          currentProgress={currentProgress}
          satisfactionByVillage={satisfactionByVillage}
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
  unlocked: boolean
  formal: boolean
  suppliedToday: boolean
  comparisonSelected: boolean
  onToggleFormal: () => void
  onToggleSupplied: () => void
  onToggleComparison: () => void
}) {
  const bestMatch = matches[0]
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
        />

        <div className="match-list">
          <div className="section-title">
            <strong>完全滿足配方</strong>
            <span>{preferencesKnown ? `${matches.length} 種` : '待確認'}</span>
          </div>
          {!preferencesKnown ? (
            <p className="muted">喜好尚未確認，無法判斷完全匹配配方。</p>
          ) : matches.length > 0 ? (
            <ol>
              {matches.map((recipe) => (
                <li key={recipe.id}>
                  <span>{formatRecipeDisplayName(recipe.name)}</span>
                  <strong>
                    {recipe.salePrice === null
                      ? '售價未知'
                      : '售價 ' + formatMoney(recipe.salePrice)}
                  </strong>
                </li>
              ))}
            </ol>
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
  const recipeLabel =
    recommendation.candidates.length === 1
      ? formatRecipeDisplayName(
          recommendation.candidates[0].candidate.name,
        )
      : `${recommendation.candidates.length} 種同價最低`

  return (
    <span className="recommendation-compact">
      最低成本：{recipeLabel} · {formatMoney(recommendation.batchIngredientCost)}／批 ·{' '}
      {sourceLabel}
    </span>
  )
}

function RecommendationDetails({
  formal,
  recommendations,
}: {
  formal: boolean
  recommendations: CustomerRecipeRecommendations
}) {
  const title = formal ? '最低成本完全匹配' : '最低成本試喝建議'

  return (
    <div className="recommendation-box">
      <div className="section-title">
        <strong>{title}</strong>
      </div>
      <RecommendationLine
        label="已實測最低成本"
        recommendation={recommendations.observedOnly}
      />
      <RecommendationLine
        label="含預測最低成本"
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
  recipe,
  currentProgress,
  satisfactionByVillage,
}: {
  recipe: RecipeCandidate
  currentProgress: ProgressMilestoneId
  satisfactionByVillage: SatisfactionByVillage
}) {
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
            {recipe.source === 'observed' ? '實測' : '預測'}
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
