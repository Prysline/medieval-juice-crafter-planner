import { useEffect, useMemo, useState } from 'react'
import { customers } from './data/customers'
import { ingredients } from './data/ingredients'
import {
  optimizerCustomerIds,
  optimizerCustomerLabel,
  optimizerMoney,
  type OptimizerCustomerScope,
} from './domain/optimizerUi'
import type {
  OptimizationCandidatePolicy,
  OptimizationCriterion,
  OptimizationObjective,
  OptimizationResult,
} from './domain/optimizer'
import type {
  ProgressMilestoneId,
  SatisfactionByVillage,
} from './types'

interface OptimizerToolsProps {
  currentProgress: ProgressMilestoneId
  satisfactionByVillage: SatisfactionByVillage
  suppliedCustomerIds: string[]
  formalCustomerIds: string[]
}

type OptimizerRunState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: OptimizationResult }
  | { status: 'error'; message: string }

type OptionalCriterion = OptimizationCriterion | 'none'

const customerById = new Map(
  customers.map((customer) => [customer.id, customer]),
)
const ingredientNameById = new Map(
  ingredients.map((ingredient) => [ingredient.id, ingredient.name]),
)

const secondaryCriterionOptions: Array<{
  value: OptimizationCriterion
  label: string
}> = [
  { value: 'minimum-machine-operations', label: '最少機器操作' },
  { value: 'minimum-jar-switches', label: '最少果汁罐換裝' },
  { value: 'minimum-cost', label: '最低原料成本' },
  { value: 'minimum-waste', label: '最少剩餘杯' },
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
  return ingredientIds.map(ingredientLabel).join(' → ')
}

function criterionLabel(criterion: OptimizationCriterion): string {
  if (criterion === 'minimum-cost') return '最低原料成本'
  if (criterion === 'minimum-waste') return '最少剩餘杯'
  if (criterion === 'maximum-known-revenue') return '最高已知銷售總額'
  if (criterion === 'maximum-known-gross-profit') return '最高已知毛利'
  if (criterion === 'minimum-machine-operations') return '最少機器操作'
  return '最少果汁罐換裝'
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

export default function OptimizerTools({
  currentProgress,
  satisfactionByVillage,
  suppliedCustomerIds,
  formalCustomerIds,
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
  const [availableJuiceJarCount, setAvailableJuiceJarCount] = useState(1)
  const [maxJarTypeSwitches, setMaxJarTypeSwitches] = useState('')
  const [runState, setRunState] = useState<OptimizerRunState>({
    status: 'idle',
  })

  const priorities = useMemo(
    () => uniquePriorities(primaryCriterion, secondaryOne, secondaryTwo),
    [primaryCriterion, secondaryOne, secondaryTwo],
  )

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
    availableJuiceJarCount,
    maxJarTypeSwitches,
  ])

  async function runOptimizer() {
    setRunState({ status: 'loading' })

    try {
      const { optimizeBatchPlan } = await import('./domain/optimizer')
      const parsedMaxSwitches =
        maxJarTypeSwitches.trim() === ''
          ? undefined
          : Math.max(0, Math.floor(Number(maxJarTypeSwitches)))

      const result = await optimizeBatchPlan({
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
        availableJuiceJarCount,
        constraints:
          parsedMaxSwitches === undefined ||
          !Number.isFinite(parsedMaxSwitches)
            ? undefined
            : { maxJarTypeSwitches: parsedMaxSwitches },
      })

      setRunState({ status: 'success', result })
    } catch (error) {
      setRunState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : '最佳化規劃器發生未知錯誤。',
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
          以 full match 顧客分配為基礎，同時計算實際果汁份數、1～5 份製作 stack、共享中間半成品、機器操作與果汁罐換裝。路線與未確認的果汁調和器產量仍不自行推導。
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
              {secondaryCriterionOptions.map((option) => (
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

          <label>
            <span>可用果汁罐</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={availableJuiceJarCount}
              onChange={(event) =>
                setAvailableJuiceJarCount(
                  Math.max(1, Math.floor(Number(event.target.value) || 1)),
                )
              }
            />
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

        <div className="optimizer-demand-summary">
          <strong>本次需求：{customerIds.length} 人</strong>
          <span>最佳化順序：{priorities.map(criterionLabel).join(' → ')}</span>
          <span>
            果汁罐：{availableJuiceJarCount} 個
            {maxJarTypeSwitches.trim() !== ''
              ? ' · 最多換裝 ' + maxJarTypeSwitches + ' 次'
              : ' · 換裝不限'}
          </span>
        </div>

        <button
          type="button"
          className="optimizer-run-button"
          disabled={customerIds.length === 0 || runState.status === 'loading'}
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
        <div className="optimizer-error" role="alert">
          <strong>最佳化規劃失敗</strong>
          <span>{runState.message}</span>
        </div>
      )}

      {runState.status === 'success' && (
        <OptimizerResultPanel
          result={runState.result}
          priorities={priorities}
        />
      )}
    </section>
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
        {secondaryCriterionOptions.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function OptimizerResultPanel({
  result,
  priorities,
}: {
  result: OptimizationResult
  priorities: OptimizationCriterion[]
}) {
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
          label="機器操作"
          value={result.machineOperations.total + ' 次'}
        />
        <MetricCard
          label="果汁罐換裝"
          value={result.jarTypeSwitches + ' 次'}
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
          製作操作：榨汁 {result.machineOperations.juicing} 次 · 調味{' '}
          {result.machineOperations.seasoning} 次 · 成品台{' '}
          {result.machineOperations.finalizing} 次
        </span>
        <span>
          可用果汁罐 {result.availableJuiceJarCount} 個；同罐改裝成另一種果汁才計入換裝。
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
              <article
                className="optimizer-batch-card"
                key={plan.recipeId}
              >
                <div>
                  <strong>{plan.recipeName}</strong>
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
          <strong>製作步驟</strong>
          <span>{result.machineOperations.total} 次操作</span>
        </div>
        <div className="optimizer-batch-list">
          {result.productionSteps.map((step) => (
            <article className="optimizer-batch-card" key={step.key}>
              <div>
                <strong>
                  {step.kind === 'juicing'
                    ? step.equipment + '：' + sequenceLabel(step.toIngredientIds)
                    : step.kind === 'seasoning'
                      ? sequenceLabel(step.fromIngredientIds) +
                        ' + ' +
                        ingredientLabel(step.addedIngredientId ?? '') +
                        ' → ' +
                        sequenceLabel(step.toIngredientIds)
                      : '果汁成品台：' + sequenceLabel(step.fromIngredientIds)}
                </strong>
                <span>{step.operationCount} 次操作</span>
              </div>
              <p>
                處理 {step.quantity} 份
                {step.operationCount > 1
                  ? '；依每次最多 5 份拆分'
                  : ''}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="optimizer-result-section">
        <div className="section-title">
          <strong>採買原料</strong>
          <span>{result.shoppingList.length} 種</span>
        </div>
        {result.shoppingList.length === 0 ? (
          <p className="empty-tool-state">目前沒有需要購買的原料。</p>
        ) : (
          <div className="optimizer-shopping-list">
            {result.shoppingList.map((item) => (
              <div className="optimizer-shopping-row" key={item.ingredientId}>
                <strong>{item.name}</strong>
                <div className="optimizer-shopping-values">
                  <span>數量：{item.quantity} 單位</span>
                  <span>單價：{optimizerMoney(item.unitPrice)}／單位</span>
                  <span>小計：{optimizerMoney(item.totalCost)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <small className="optimizer-boundary-note">
          目前只聚合原料數量；商店路線與跨村時間仍保持分層，不在此處猜測。
        </small>
      </section>

      {result.unresolvedCustomers.length > 0 && (
        <section className="optimizer-unresolved">
          <strong>
            目前沒有可靠 full match：{result.unresolvedCustomers.length} 人
          </strong>
          <p>
            {result.unresolvedCustomers.map(customerLabel).join('、')}
          </p>
        </section>
      )}
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
