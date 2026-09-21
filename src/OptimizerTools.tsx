import { useEffect, useMemo, useState } from 'react'
import { customers } from './data/customers'
import {
  optimizerCustomerIds,
  optimizerCustomerLabel,
  optimizerMoney,
  type OptimizerCustomerScope,
} from './domain/optimizerUi'
import type {
  OptimizationCandidatePolicy,
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

const customerById = new Map(
  customers.map((customer) => [customer.id, customer]),
)

function customerLabel(customerId: string): string {
  const customer = customerById.get(customerId)
  return customer ? optimizerCustomerLabel(customer) : customerId
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
  const [objective, setObjective] =
    useState<OptimizationObjective>('minimum-cost')
  const [runState, setRunState] = useState<OptimizerRunState>({
    status: 'idle',
  })

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
    objective,
  ])

  async function runOptimizer() {
    setRunState({ status: 'loading' })

    try {
      const { optimizeBatchPlan } = await import('./domain/optimizer')
      const result = await optimizeBatchPlan({
        customerIds,
        currentProgress,
        suppliedCustomerIds,
        satisfactionByVillage,
        candidatePolicy,
        objective,
      })

      setRunState({ status: 'success', result })
    } catch (error) {
      setRunState({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : '批次規劃器發生未知錯誤。',
      })
    }
  }

  return (
    <section className="optimizer-tools" aria-label="批次規劃">
      <div className="tool-panel optimizer-control-panel">
        <div className="tool-heading">
          <div>
            <p className="tool-kicker">Batch Optimizer</p>
            <h2>全日批次規劃</h2>
          </div>
          <span className="tool-badge">{customerIds.length} 人需求</span>
        </div>

        <p className="tool-description">
          預設只處理目前已解鎖、且今日尚未供應的顧客。第一版只使用可靠 full match；不處理庫存、果汁罐、背包、商人分配或路線。
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
            <span>最佳化目標</span>
            <select
              value={objective}
              onChange={(event) =>
                setObjective(event.target.value as OptimizationObjective)
              }
            >
              <option value="minimum-cost">最低原料成本</option>
              <option value="minimum-waste">最少剩餘杯</option>
            </select>
          </label>
        </div>

        <div className="optimizer-demand-summary">
          <strong>本次需求：{customerIds.length} 人</strong>
          <span>
            已解鎖且今日未供應；範圍：
            {scope === 'all'
              ? '全部'
              : scope === 'formal'
                ? '正式顧客'
                : '潛在顧客'}
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
            : '產生批次規劃'}
        </button>

        <p className="optimizer-lazy-note">
          求解器只會在按下規劃後 lazy-load；第一次執行需要載入 HiGHS WASM。
        </p>
      </div>

      {runState.status === 'error' && (
        <div className="optimizer-error" role="alert">
          <strong>批次規劃失敗</strong>
          <span>{runState.message}</span>
        </div>
      )}

      {runState.status === 'success' && (
        <OptimizerResultPanel result={runState.result} objective={objective} />
      )}
    </section>
  )
}

function OptimizerResultPanel({
  result,
  objective,
}: {
  result: OptimizationResult
  objective: OptimizationObjective
}) {
  return (
    <div className="optimizer-results">
      <div className="optimizer-metrics" aria-label="最佳化摘要">
        <MetricCard
          label="原料總成本"
          value={optimizerMoney(result.totalIngredientCost)}
        />
        <MetricCard label="製作批數" value={String(result.batches.length)} />
        <MetricCard
          label="已分配 / 產出"
          value={`${result.assignedServings} / ${result.producedServings}`}
        />
        <MetricCard label="剩餘杯" value={String(result.leftoverServings)} />
      </div>

      <div className="optimizer-result-note">
        <strong>
          {objective === 'minimum-cost' ? '最低成本模式' : '最少浪費模式'}
        </strong>
        <span>
          {objective === 'minimum-cost'
            ? '先最小化原料成本；同成本再減少批數／剩餘杯與配方種類。'
            : '先最小化批數／剩餘杯；再比較原料成本與配方種類。'}
        </span>
      </div>

      <section className="optimizer-result-section">
        <div className="section-title">
          <strong>製作批次</strong>
          <span>{result.batches.length} 批</span>
        </div>
        {result.batches.length === 0 ? (
          <p className="empty-tool-state">本次沒有可製作的批次。</p>
        ) : (
          <div className="optimizer-batch-list">
            {result.batches.map((batch) => (
              <article
                className="optimizer-batch-card"
                key={`${batch.recipeId}-${batch.batchNumber}`}
              >
                <div>
                  <strong>
                    {batch.recipeName} · 第 {batch.batchNumber} 批
                  </strong>
                  <span>
                    原料成本：{optimizerMoney(batch.batchIngredientCost)}／批
                  </span>
                </div>
                <p>
                  {batch.customerIds.length > 0
                    ? `分配顧客：${batch.customerIds
                        .map(customerLabel)
                        .join('、')}`
                    : '此批目前沒有分配顧客'}
                </p>
              </article>
            ))}
          </div>
        )}
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
          目前只聚合原料數量；若同一原料可在多個商店取得，不在此版本替玩家選商人。
        </small>
      </section>

      <section className="optimizer-result-section">
        <div className="section-title">
          <strong>顧客分配</strong>
          <span>{result.assignments.length} 人</span>
        </div>
        <div className="optimizer-assignment-list">
          {result.assignments.map((assignment) => {
            const batch = result.batches.find(
              (item) =>
                item.recipeId === assignment.recipeId &&
                item.customerIds.includes(assignment.customerId),
            )
            return (
              <div
                className="optimizer-assignment-row"
                key={assignment.customerId}
              >
                <strong>{customerLabel(assignment.customerId)}</strong>
                <span>{batch?.recipeName ?? assignment.recipeId}</span>
              </div>
            )
          })}
        </div>
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
