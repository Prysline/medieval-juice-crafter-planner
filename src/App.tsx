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

  const normalizedQuery = query.trim().toLocaleLowerCase('zh-Hant')

  const customerRows = useMemo(() => {
    return customers
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
  }, [normalizedQuery, stage])

  const recipeRows = useMemo(() => {
    return recipes
      .filter((recipe) => recipe.stage <= stage)
      .filter((recipe) => {
        if (!normalizedQuery) return true
        return [
          recipe.name,
          ...recipe.ingredients,
          ...recipe.effects,
          ...recipe.equipment,
        ]
          .join(' ')
          .toLocaleLowerCase('zh-Hant')
          .includes(normalizedQuery)
      })
      .sort((a, b) => b.salePrice - a.salePrice || a.name.localeCompare(b.name, 'zh-Hant'))
  }, [normalizedQuery, stage])

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
        <section className="result-list" aria-label="顧客">
          {customerRows.map(({ customer, matches }) => (
            <CustomerRow
              key={customer.id}
              customer={customer}
              matches={matches}
              unlocked={customerIsUnlocked(customer, satisfaction)}
            />
          ))}
        </section>
      ) : (
        <section className="result-list" aria-label="配方">
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
    <details className="list-row">
      <summary>
        <div className="summary-main">
          <div className="summary-title-line">
            <strong>{customer.name}</strong>
            <span>{customer.occupation}</span>
            {customer.satisfactionRequired > 0 && (
              <span className={unlocked ? 'status unlocked' : 'status locked'}>
                {unlocked ? '已達門檻' : `滿意度 ${customer.satisfactionRequired}`}
              </span>
            )}
          </div>
          <p className="summary-meta">
            {customer.preferences.map((preference) => preference.value).join('・')}
          </p>
        </div>

        <div className="summary-result">
          {bestMatch ? (
            <>
              <span>{bestMatch.name}</span>
              <strong>{bestMatch.salePrice}</strong>
            </>
          ) : (
            <span className="muted">目前無完全匹配</span>
          )}
        </div>
      </summary>

      <div className="row-details">
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
                  <strong>{recipe.salePrice}</strong>
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
    <details className="list-row">
      <summary>
        <div className="summary-main">
          <div className="summary-title-line">
            <strong>{recipe.name}</strong>
            <span>階段 {recipe.stage}</span>
          </div>
          <p className="summary-meta">{recipe.ingredients.join('・')}</p>
        </div>

        <div className="summary-result recipe-price">
          <strong>{recipe.salePrice}</strong>
        </div>
      </summary>

      <div className="row-details">
        <TagGroup title="原料" tags={recipe.ingredients} />
        <TagGroup title="成品特性" tags={recipe.effects} />
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
