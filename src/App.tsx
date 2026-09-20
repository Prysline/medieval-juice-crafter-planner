import { useMemo, useState } from 'react'
import { customers } from './data/customers'
import { recipes } from './data/recipes'
import { stages } from './data/stages'
import {
  customerIsUnlocked,
  matchingRecipesForCustomer,
  recipeMatchesCustomer,
} from './domain/matching'
import type { Customer, EffectValue, Recipe, StageId } from './types'

type Tab = 'customers' | 'recipes'
type SortDirection = 'asc' | 'desc'
type CustomerSortKey = 'name' | 'bestMatch' | 'bestPrice'
type RecipeSortKey = 'name' | 'salePrice'
type CustomerVisibility = 'available' | 'all'

const scheduleLabels = {
  leave_home: '出家門',
  outside_village_by: '已在村外',
  return_village: '回村',
} as const

const recipeOrder = new Map(recipes.map((recipe, index) => [recipe.id, index]))

const villageNames: Record<Customer['villageId'], string> = {
  'east-harbor': '東港村',
}

function readStoredNumber(key: string, fallback: number) {
  const raw = window.localStorage.getItem(key)
  if (raw === null) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function readStoredStringArray(key: string): string[] {
  const raw = window.localStorage.getItem(key)
  if (raw === null) return []

  try {
    const value = JSON.parse(raw)
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function formatEffect(effect: EffectValue) {
  return `${effect.name}（${effect.value}）`
}

function App() {
  const [stage, setStage] = useState<StageId>(() => {
    const stored = readStoredNumber('mjc-stage', 2)
    return stored === 1 ? 1 : 2
  })
  const [satisfaction, setSatisfaction] = useState(() =>
    readStoredNumber('mjc-satisfaction', 0),
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
  const [suppliedCustomerIds, setSuppliedCustomerIds] = useState<string[]>(() =>
    readStoredStringArray('mjc-supplied-today'),
  )

  const normalizedQuery = query.trim().toLocaleLowerCase('zh-Hant')

  const customerRows = useMemo(() => {
    const rows = customers
      .map((customer) => ({
        customer,
        unlocked: customerIsUnlocked(customer, satisfaction),
        matches: matchingRecipesForCustomer(recipes, customer, stage),
      }))
      .filter(({ unlocked }) => customerVisibility === 'all' || unlocked)
      .filter(({ customer, matches }) => {
        if (!normalizedQuery) return true
        const haystack = [
          customer.name,
          customer.occupation,
          ...customer.preferences.map((preference) => preference.value),
          ...matches.map((recipe) => recipe.name),
        ]
          .join(' ')
          .toLocaleLowerCase('zh-Hant')
        return haystack.includes(normalizedQuery)
      })

    const direction = customerSortDirection === 'asc' ? 1 : -1

    return rows.sort((a, b) => {
      const aBest = a.matches[0]
      const bBest = b.matches[0]

      if (customerSortKey === 'bestMatch') {
        if (!aBest && !bBest) {
          return a.customer.name.localeCompare(b.customer.name, 'zh-Hant')
        }
        if (!aBest) return 1
        if (!bBest) return -1

        const orderDelta =
          (recipeOrder.get(aBest.id) ?? Number.MAX_SAFE_INTEGER) -
          (recipeOrder.get(bBest.id) ?? Number.MAX_SAFE_INTEGER)

        return (
          orderDelta * direction ||
          a.customer.name.localeCompare(b.customer.name, 'zh-Hant')
        )
      }

      if (customerSortKey === 'bestPrice') {
        if (!aBest && !bBest) {
          return a.customer.name.localeCompare(b.customer.name, 'zh-Hant')
        }
        if (!aBest) return 1
        if (!bBest) return -1

        return (
          (aBest.salePrice - bBest.salePrice) * direction ||
          (recipeOrder.get(aBest.id) ?? 0) - (recipeOrder.get(bBest.id) ?? 0) ||
          a.customer.name.localeCompare(b.customer.name, 'zh-Hant')
        )
      }

      return a.customer.name.localeCompare(b.customer.name, 'zh-Hant') * direction
    })
  }, [
    normalizedQuery,
    stage,
    satisfaction,
    customerVisibility,
    customerSortDirection,
    customerSortKey,
  ])

  const recipeRows = useMemo(() => {
    const rows = recipes
      .filter((recipe) => recipe.stage <= stage)
      .filter((recipe) => {
        if (!normalizedQuery) return true
        return [
          recipe.name,
          ...recipe.ingredients,
          ...recipe.effects.map((effect) => effect.name),
          ...recipe.equipment,
        ]
          .join(' ')
          .toLocaleLowerCase('zh-Hant')
          .includes(normalizedQuery)
      })

    const direction = recipeSortDirection === 'asc' ? 1 : -1

    return rows.sort((a, b) => {
      if (recipeSortKey === 'salePrice') {
        return (
          (a.salePrice - b.salePrice) * direction ||
          (recipeOrder.get(a.id) ?? 0) - (recipeOrder.get(b.id) ?? 0)
        )
      }

      return a.name.localeCompare(b.name, 'zh-Hant') * direction
    })
  }, [
    normalizedQuery,
    stage,
    recipeSortDirection,
    recipeSortKey,
  ])

  function updateStage(value: StageId) {
    setStage(value)
    window.localStorage.setItem('mjc-stage', String(value))
  }

  function updateSatisfaction(value: number) {
    const next = Math.max(0, Math.floor(value || 0))
    setSatisfaction(next)
    window.localStorage.setItem('mjc-satisfaction', String(next))
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

      window.localStorage.setItem('mjc-supplied-today', JSON.stringify(next))
      return next
    })
  }

  function resetSuppliedToday() {
    setSuppliedCustomerIds([])
    window.localStorage.removeItem('mjc-supplied-today')
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
          <span>目前階段</span>
          <select
            value={stage}
            onChange={(event) => updateStage(Number(event.target.value) as StageId)}
          >
            {stages.map((item) => (
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
            value={satisfaction}
            onChange={(event) => updateSatisfaction(Number(event.target.value))}
          />
        </label>
      </section>

      <section className="search-panel">
        <input
          aria-label="搜尋"
          placeholder="搜尋顧客、職業、配方、原料、特性……"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button className="clear-button" type="button" onClick={() => setQuery('')}>
            清除
          </button>
        )}
      </section>

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
              className="reset-supply-button"
              disabled={suppliedCustomerIds.length === 0}
              onClick={resetSuppliedToday}
            >
              重置今日供應
            </button>
            <span>
              今日已供應 {suppliedCustomerIds.length} 人 · 東港村滿意度 {satisfaction}
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

          {customerRows.map(({ customer, matches, unlocked }) => (
            <CustomerRow
              key={customer.id}
              customer={customer}
              matches={matches}
              unlocked={unlocked}
              suppliedToday={suppliedCustomerIds.includes(customer.id)}
              onToggleSupplied={() => toggleSuppliedToday(customer.id)}
            />
          ))}
          </section>
        </>
      ) : (
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
            <SortableHeader
              label="售價"
              active={recipeSortKey === 'salePrice'}
              direction={recipeSortDirection}
              alignEnd
              onClick={() => toggleRecipeSort('salePrice')}
            />
          </div>

          {recipeRows.map((recipe) => (
            <RecipeRow key={recipe.id} recipe={recipe} satisfaction={satisfaction} />
          ))}
        </section>
      )}

      <footer>
        目前資料範圍：東港村、階段一～二。未確認規則不自動推導。
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
  unlocked,
  suppliedToday,
  onToggleSupplied,
}: {
  customer: Customer
  matches: Recipe[]
  unlocked: boolean
  suppliedToday: boolean
  onToggleSupplied: () => void
}) {
  const bestMatch = matches[0]

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
          {customer.preferences.map((preference) => preference.value).join('・')}
        </div>

        <div className="best-match-cell">
          {bestMatch ? bestMatch.name : <span className="muted">無完全匹配</span>}
        </div>

        <div className="price-cell align-end">
          {bestMatch ? bestMatch.salePrice : '—'}
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

        <TagGroup
          title="喜好"
          tags={customer.preferences.map((preference) => preference.value)}
        />

        <div className="match-list">
          <div className="section-title">
            <strong>完全滿足配方</strong>
            <span>{matches.length} 種</span>
          </div>
          {matches.length > 0 ? (
            <ol>
              {matches.map((recipe) => (
                <li key={recipe.id}>
                  <span>{recipe.name}</span>
                  <strong>售價 {recipe.salePrice}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">目前階段沒有能完全滿足所有喜好的已知配方。</p>
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

function RecipeRow({
  recipe,
  satisfaction,
}: {
  recipe: Recipe
  satisfaction: number
}) {
  const matchingCustomers = customers
    .filter((customer) => customerIsUnlocked(customer, satisfaction))
    .filter((customer) => recipeMatchesCustomer(recipe, customer))

  return (
    <details className="table-row">
      <summary className="recipe-columns">
        <div className="primary-cell">
          <strong>{recipe.name}</strong>
          <span className="cell-secondary">階段 {recipe.stage}</span>
        </div>

        <div>{recipe.ingredients.join(' → ')}</div>

        <div className="effects-cell">{recipe.effects.map(formatEffect).join('・')}</div>

        <div className="price-cell align-end">{recipe.salePrice}</div>
      </summary>

      <div className="row-details">
        <TagGroup title="原料順序" tags={[recipe.ingredients.join(' → ')]} />
        <TagGroup title="成品特性" tags={recipe.effects.map(formatEffect)} />
        <TagGroup title="所需設備" tags={recipe.equipment} />

        <div className="match-list">
          <div className="section-title">
            <strong>可完全滿足顧客</strong>
            <span>{matchingCustomers.length} 人</span>
          </div>
          <p className="customer-names">
            {matchingCustomers.length
              ? matchingCustomers
                  .map((customer) => `${customer.name}(${customer.occupation})`)
                  .join('、')
              : '目前滿意度下沒有能完全滿足的已知顧客。'}
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
