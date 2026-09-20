import { useMemo, useState } from 'react'
import { customers } from './data/customers'
import { recipes } from './data/recipes'
import { stages } from './data/stages'
import {
  customerIsUnlocked,
  matchingRecipesForCustomer,
  recipeMatchesCustomer,
} from './domain/matching'
import type { Customer, Recipe, StageId } from './types'

type Tab = 'customers' | 'recipes'
type SortDirection = 'asc' | 'desc'
type CustomerSortKey = 'name' | 'bestPrice' | 'satisfaction' | 'matchCount'
type RecipeSortKey = 'name' | 'salePrice' | 'stage' | 'customerCount'

const scheduleLabels = {
  leave_home: '出家門',
  outside_village_by: '已在村外',
  return_village: '回村',
} as const

function readStoredNumber(key: string, fallback: number) {
  const raw = window.localStorage.getItem(key)
  if (raw === null) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
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
  const [customerSortKey, setCustomerSortKey] = useState<CustomerSortKey>('name')
  const [customerSortDirection, setCustomerSortDirection] =
    useState<SortDirection>('asc')
  const [recipeSortKey, setRecipeSortKey] = useState<RecipeSortKey>('salePrice')
  const [recipeSortDirection, setRecipeSortDirection] =
    useState<SortDirection>('desc')

  const normalizedQuery = query.trim().toLocaleLowerCase('zh-Hant')

  const customerRows = useMemo(() => {
    const rows = customers
      .map((customer) => ({
        customer,
        matches: matchingRecipesForCustomer(recipes, customer, stage),
      }))
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
      if (customerSortKey === 'bestPrice') {
        return ((a.matches[0]?.salePrice ?? -1) - (b.matches[0]?.salePrice ?? -1)) * direction
      }
      if (customerSortKey === 'satisfaction') {
        return (
          (a.customer.satisfactionRequired - b.customer.satisfactionRequired) * direction ||
          a.customer.name.localeCompare(b.customer.name, 'zh-Hant')
        )
      }
      if (customerSortKey === 'matchCount') {
        return (
          (a.matches.length - b.matches.length) * direction ||
          a.customer.name.localeCompare(b.customer.name, 'zh-Hant')
        )
      }

      return a.customer.name.localeCompare(b.customer.name, 'zh-Hant') * direction
    })
  }, [
    normalizedQuery,
    stage,
    customerSortDirection,
    customerSortKey,
  ])

  const recipeRows = useMemo(() => {
    const rows = recipes
      .filter((recipe) => recipe.stage <= stage)
      .map((recipe) => ({
        recipe,
        customerCount: customers
          .filter((customer) => customerIsUnlocked(customer, satisfaction))
          .filter((customer) => recipeMatchesCustomer(recipe, customer)).length,
      }))
      .filter(({ recipe }) => {
        if (!normalizedQuery) return true
        return [
          recipe.name,
          ...(recipe.gameNameExamples ?? []),
          ...recipe.ingredients,
          ...recipe.effects,
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
          (a.recipe.salePrice - b.recipe.salePrice) * direction ||
          a.recipe.name.localeCompare(b.recipe.name, 'zh-Hant')
        )
      }
      if (recipeSortKey === 'stage') {
        return (
          (a.recipe.stage - b.recipe.stage) * direction ||
          a.recipe.name.localeCompare(b.recipe.name, 'zh-Hant')
        )
      }
      if (recipeSortKey === 'customerCount') {
        return (
          (a.customerCount - b.customerCount) * direction ||
          a.recipe.name.localeCompare(b.recipe.name, 'zh-Hant')
        )
      }

      return a.recipe.name.localeCompare(b.recipe.name, 'zh-Hant') * direction
    })
  }, [
    normalizedQuery,
    stage,
    satisfaction,
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
          <SortBar
            label="顧客排序"
            value={customerSortKey}
            direction={customerSortDirection}
            options={[
              ['name', '姓名'],
              ['bestPrice', '最高完全匹配售價'],
              ['satisfaction', '滿意度門檻'],
              ['matchCount', '完全匹配配方數'],
            ]}
            onChange={(value) => setCustomerSortKey(value as CustomerSortKey)}
            onDirectionChange={setCustomerSortDirection}
          />

          <section className="table-list customer-table" aria-label="顧客">
            <div className="table-head customer-columns" aria-hidden="true">
              <span>顧客</span>
              <span>喜好</span>
              <span>最佳完全匹配</span>
              <span className="align-end">售價</span>
            </div>

            {customerRows.map(({ customer, matches }) => (
              <CustomerRow
                key={customer.id}
                customer={customer}
                matches={matches}
                unlocked={customerIsUnlocked(customer, satisfaction)}
              />
            ))}
          </section>
        </>
      ) : (
        <>
          <SortBar
            label="配方排序"
            value={recipeSortKey}
            direction={recipeSortDirection}
            options={[
              ['salePrice', '售價'],
              ['name', '配方名稱'],
              ['stage', '解鎖階段'],
              ['customerCount', '可完全滿足顧客數'],
            ]}
            onChange={(value) => setRecipeSortKey(value as RecipeSortKey)}
            onDirectionChange={setRecipeSortDirection}
          />

          <section className="table-list recipe-table" aria-label="配方">
            <div className="table-head recipe-columns" aria-hidden="true">
              <span>配方</span>
              <span>原料</span>
              <span>成品特性</span>
              <span className="align-end">售價</span>
            </div>

            {recipeRows.map(({ recipe }) => (
              <RecipeRow key={recipe.id} recipe={recipe} satisfaction={satisfaction} />
            ))}
          </section>
        </>
      )}

      <footer>
        目前資料範圍：東港村、階段一～二。未確認規則不自動推導。
      </footer>
    </main>
  )
}

function SortBar({
  label,
  value,
  direction,
  options,
  onChange,
  onDirectionChange,
}: {
  label: string
  value: string
  direction: SortDirection
  options: Array<[string, string]>
  onChange: (value: string) => void
  onDirectionChange: (value: SortDirection) => void
}) {
  return (
    <div className="sort-bar">
      <label>
        <span>{label}</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map(([optionValue, optionLabel]) => (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="direction-button"
        onClick={() => onDirectionChange(direction === 'asc' ? 'desc' : 'asc')}
        aria-label={direction === 'asc' ? '目前升冪，切換成降冪' : '目前降冪，切換成升冪'}
      >
        {direction === 'asc' ? '升冪 ↑' : '降冪 ↓'}
      </button>
    </div>
  )
}

function CustomerRow({
  customer,
  matches,
  unlocked,
}: {
  customer: Customer
  matches: Recipe[]
  unlocked: boolean
}) {
  const bestMatch = matches[0]

  return (
    <details className="table-row">
      <summary className="customer-columns">
        <div className="primary-cell">
          <strong>{customer.name}</strong>
          <span className="cell-secondary">{customer.occupation}</span>
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
      </summary>

      <div className="row-details">
        {customer.satisfactionRequired > 0 && (
          <div className="detail-line">
            <span className="detail-label">顧客滿意度門檻</span>
            <span className={unlocked ? 'status unlocked' : 'status locked'}>
              {unlocked ? `${customer.satisfactionRequired}（已達）` : customer.satisfactionRequired}
            </span>
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

        <div>{recipe.ingredients.join('・')}</div>

        <div className="effects-cell">{recipe.effects.join('・')}</div>

        <div className="price-cell align-end">{recipe.salePrice}</div>
      </summary>

      <div className="row-details">
        <TagGroup title="原料" tags={recipe.ingredients} />
        <TagGroup title="成品特性" tags={recipe.effects} />
        <TagGroup title="所需設備" tags={recipe.equipment} />

        {recipe.gameNameRandom && recipe.gameNameExamples && (
          <div className="detail-line">
            <span className="detail-label">遊戲內名稱</span>
            <span>
              隨機；已觀察：{recipe.gameNameExamples.join('、')}
            </span>
          </div>
        )}

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
