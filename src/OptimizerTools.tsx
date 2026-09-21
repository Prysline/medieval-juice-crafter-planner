import { useEffect, useMemo, useState } from 'react'
import { customers } from './data/customers'
import { ingredients } from './data/ingredients'
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
import type {
  MultiTripJuiceJarLoad,
  MultiTripReplenishmentPlan,
  UsedCupTripPolicy,
} from './domain/multiTripReplenishment'
import type { PreparationShortfall } from './domain/preparationShortfall'
import type { ProductionLogisticsPlan } from './domain/productionLogistics'
import { buildInventoryCapacitySummary } from './domain/inventoryCapacity'
import {
  readInventoryState,
  resizeJuiceJarInventory,
  writeInventoryState,
} from './storage/inventoryState'
import {
  readPlannerSettings,
  writePlannerSettings,
} from './storage/plannerSettings'
import type {
  InventoryState,
  PlannerSettings,
  ProgressMilestoneId,
  SatisfactionByVillage,
} from './types'

interface OptimizerToolsProps {
  currentProgress: ProgressMilestoneId
  satisfactionByVillage: SatisfactionByVillage
  suppliedCustomerIds: string[]
  formalCustomerIds: string[]
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
    }
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
  return ingredientIds.map(ingredientLabel).join(' ▸ ')
}

function criterionLabel(criterion: OptimizationCriterion): string {
  if (criterion === 'minimum-cost') return '最低原料成本'
  if (criterion === 'minimum-waste') return '最少剩餘杯'
  if (criterion === 'maximum-known-revenue') return '最高已知銷售總額'
  if (criterion === 'maximum-known-gross-profit') return '最高已知毛利'
  if (criterion === 'minimum-machine-operations') return '最少機器操作'
  return '最少果汁罐換裝'
}

function jarFillActionLabel(load: MultiTripJuiceJarLoad): string {
  if (load.fillAction === 'initial-fill') return '首次裝填'
  if (load.fillAction === 'refill-same-type') return '補裝同種'

  return (
    (load.previousRecipeName ?? load.previousRecipeId ?? '前一種果汁') +
    ' → ' +
    load.recipeName +
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
  const [inventoryState, setInventoryState] = useState<InventoryState>(() =>
    readInventoryState(window.localStorage),
  )
  const [plannerSettings, setPlannerSettings] = useState<PlannerSettings>(() =>
    readPlannerSettings(window.localStorage),
  )
  const [maxJarTypeSwitches, setMaxJarTypeSwitches] = useState('')
  const [runState, setRunState] = useState<OptimizerRunState>({
    status: 'idle',
  })

  const priorities = useMemo(
    () => uniquePriorities(primaryCriterion, secondaryOne, secondaryTwo),
    [primaryCriterion, secondaryOne, secondaryTwo],
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
    const nextInventory = resizeJuiceJarInventory(inventoryState, count)
    persistInventory(nextInventory)

    if (
      plannerSettings.carriedJuiceJarCount >
      nextInventory.juiceJars.length
    ) {
      persistPlannerSettings({
        ...plannerSettings,
        carriedJuiceJarCount: nextInventory.juiceJars.length,
      })
    }
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
  ])

  async function runOptimizer() {
    setRunState({ status: 'loading' })

    try {
      const [
        { optimizeBatchPlan },
        { buildPreparationDemand },
        { buildPreparationShortfall },
        { buildProductionLogisticsPlan },
        { buildMultiTripReplenishmentPlan },
      ] = await Promise.all([
        import('./domain/optimizer'),
        import('./domain/preparationDemand'),
        import('./domain/preparationShortfall'),
        import('./domain/productionLogistics'),
        import('./domain/multiTripReplenishment'),
      ])
      const parsedMaxSwitches =
        maxJarTypeSwitches.trim() === ''
          ? undefined
          : Math.max(0, Math.floor(Number(maxJarTypeSwitches)))

      if (capacitySummary.effectiveCarriedJuiceJarCount < 1) {
        throw new Error(
          '請先設定至少 1 個實際持有且常駐攜帶的果汁罐。',
        )
      }

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
        availableJuiceJarCount:
          capacitySummary.effectiveCarriedJuiceJarCount,
        constraints:
          parsedMaxSwitches === undefined ||
          !Number.isFinite(parsedMaxSwitches)
            ? undefined
            : { maxJarTypeSwitches: parsedMaxSwitches },
      })

      const preparationDemand = buildPreparationDemand(result)
      const preparationShortfall = buildPreparationShortfall(
        preparationDemand,
        inventoryState,
      )
      const productionLogistics = buildProductionLogisticsPlan(
        preparationShortfall,
        inventoryState,
        plannerSettings,
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
        const stationaryJuiceJarCount = Math.min(
          Math.max(
            0,
            capacitySummary.physicalJuiceJarCount -
              result.availableJuiceJarCount,
          ),
          capacitySummary.jarRackStagingCapacity,
        )
        const plan = buildMultiTripReplenishmentPlan(
          preparationDemand,
          policy,
          result.availableJuiceJarCount,
          {
            cleanCups: inventoryState.cleanCups,
            usedCups: inventoryState.usedCups,
          },
          stationaryJuiceJarCount,
        )
        if (plan.jarTypeSwitches !== result.jarTypeSwitches) {
          throw new Error(
            '果汁罐換裝與販售趟數排程不一致，已停止顯示結果。',
          )
        }
        return plan
      }

      const selectedSalesTripPlan =
        buildCheckedSalesTripPlan(selectedPolicy)
      let alternateSalesTripPlan: MultiTripReplenishmentPlan | null = null
      let alternateError: string | null = null
      try {
        alternateSalesTripPlan =
          buildCheckedSalesTripPlan(alternatePolicy)
      } catch (error) {
        alternateError =
          error instanceof Error
            ? error.message
            : '替代杯具策略目前無法產生可行排程。'
      }

      const salesTripPlans: SalesTripPlans = {
        selected: selectedSalesTripPlan,
        alternate: alternateSalesTripPlan,
        alternatePolicy,
        alternateError,
      }

      setRunState({
        status: 'success',
        result,
        preparationShortfall,
        productionLogistics,
        salesTripPlans,
      })
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
            <span>實際持有果汁罐</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={inventoryState.juiceJars.length}
              onChange={(event) =>
                setPhysicalJuiceJarCount(
                  Math.max(0, Math.floor(Number(event.target.value) || 0)),
                )
              }
            />
          </label>

          <label>
            <span>常駐攜帶果汁罐</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={inventoryState.juiceJars.length}
              value={plannerSettings.carriedJuiceJarCount}
              onChange={(event) =>
                persistPlannerSettings({
                  ...plannerSettings,
                  carriedJuiceJarCount: Math.min(
                    inventoryState.juiceJars.length,
                    Math.max(
                      0,
                      Math.floor(Number(event.target.value) || 0),
                    ),
                  ),
                })
              }
            />
          </label>

          <label>
            <span>一般架子數</span>
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
            <span>果汁罐架數</span>
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
            果汁罐：持有 {capacitySummary.physicalJuiceJarCount} · 常駐攜帶{' '}
            {capacitySummary.effectiveCarriedJuiceJarCount}
            {maxJarTypeSwitches.trim() !== ''
              ? ' · 最多換裝 ' + maxJarTypeSwitches + ' 次'
              : ' · 換裝不限'}
          </span>
          <span>
            一般架子 {inventoryState.shelfCount} 架 /{' '}
            {capacitySummary.shelfSlotCapacity} slots · 果汁罐架{' '}
            {inventoryState.jarRackCount} 架 /{' '}
            {capacitySummary.jarRackStagingCapacity} slots
          </span>
          <span>
            常駐果汁罐占 {capacitySummary.carriedJarSlotCost} / 10 背包 slots；
            其他搬運剩 {capacitySummary.backpackSlotsRemainingAfterCarriedJars} 格
          </span>
        </div>

        {capacitySummary.effectiveCarriedJuiceJarCount < 1 && (
          <p className="optimizer-capacity-warning" role="status">
            請先設定至少 1 個「實際持有果汁罐」，並將「常駐攜帶果汁罐」設為至少 1。
          </p>
        )}

        <button
          type="button"
          className="optimizer-run-button"
          disabled={
            customerIds.length === 0 ||
            runState.status === 'loading' ||
            capacitySummary.effectiveCarriedJuiceJarCount < 1
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
        <div className="optimizer-error" role="alert">
          <strong>最佳化規劃失敗</strong>
          <span>{runState.message}</span>
        </div>
      )}

      {runState.status === 'success' && (
        <OptimizerResultPanel
          result={runState.result}
          preparationShortfall={runState.preparationShortfall}
          productionLogistics={runState.productionLogistics}
          priorities={priorities}
          salesTripPlans={runState.salesTripPlans}
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

function machineSlotLabels(equipment: string): string[] {
  if (equipment === '柑橘榨汁機' || equipment === '榨汁機') {
    return ['input', 'output']
  }
  if (equipment === '調味器') {
    return ['果汁 input', '調味材料 input', 'output']
  }
  if (equipment === '果汁成品台') {
    return ['果汁 input', '水 input', 'output']
  }
  if (equipment === '果汁調和器') {
    return ['果汁 A input', '果汁 B input', 'output']
  }
  return ['machine slots 依設備規則']
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

function OptimizerResultPanel({
  result,
  preparationShortfall,
  productionLogistics,
  priorities,
  salesTripPlans,
}: {
  result: OptimizationResult
  preparationShortfall: PreparationShortfall
  productionLogistics: ProductionLogisticsPlan
  priorities: OptimizationCriterion[]
  salesTripPlans: SalesTripPlans
}) {
  const selectedSalesTripPlan = salesTripPlans.selected
  const alternateSalesTripPlan = salesTripPlans.alternate
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
          常駐攜帶果汁罐 {result.availableJuiceJarCount} 個；同罐改裝成另一種果汁才計入換裝。
        </span>
        <span>
          販售摘要採「{tripPolicyLabel(selectedSalesTripPlan)}」；杯具依實際持有量與 clean → used stack transition 計算，替代 policy 可在販售排程展開比較。
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

        {Object.keys(productionStepsByEquipment).length === 0 ? (
          <p className="empty-tool-state">目前沒有需要新增製作的步驟。</p>
        ) : (
          Object.entries(productionStepsByEquipment).map(
            ([equipment, steps]) => (
              <div className="optimizer-batch-list" key={equipment}>
                <article className="optimizer-batch-card">
                  <div>
                    <strong>{equipment}</strong>
                    <span>
                      {steps.reduce(
                        (sum, step) => sum + step.operationCount,
                        0,
                      )}{' '}
                      次操作
                    </span>
                  </div>
                  <div
                    className="optimizer-machine-slots"
                    aria-label={equipment + ' machine slots'}
                  >
                    {machineSlotLabels(equipment).map((slot) => (
                      <span key={slot}>{slot}</span>
                    ))}
                  </div>
                </article>

                {steps.map((step) => (
                  <article className="optimizer-batch-card" key={step.key}>
                    <div>
                      <strong>{productionStepLabel(step)}</strong>
                      <span>{step.operationCount} 次操作</span>
                    </div>
                    <p>總處理量：{step.quantity} 份</p>
                    <div className="optimizer-operation-splits">
                      {optimizerOperationQuantities(step.quantity).map(
                        (quantity, index) => (
                          <span key={index}>
                            操作 {index + 1}：{quantity} 份
                          </span>
                        ),
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ),
          )
        )}

        <small className="optimizer-boundary-note">
          ▸ 表示配方內部 ingredient / sequence 順序；→ 只用於實際加工或狀態轉換。此區使用 stock offset 後的 net production plan，不再重複顯示 gross optimizer steps。現行 inventory 尚未保存每件物品的精確位置，因此 Phase 3 把既有 production materials 視為 home supply，依一般架與背包容量建立 deterministic feasible placement / transfer；同時追蹤 machine slots 與 finalizer output 的 physical jar receiver。罐內既有內容與首次換裝相容性仍維持 deferred，clean / used cups 的實際占位與 transition 留到 Phase 4。
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
            {productionLogistics.initialSnapshot.shelfSlotsAvailable} slots · 背包一般物品{' '}
            {productionLogistics.initialSnapshot.backpackSlotsUsed}/
            {productionLogistics.initialSnapshot.backpackSlotsAvailable} slots · 常駐果汁罐{' '}
            {productionLogistics.initialSnapshot.carriedJarSlots} slots · 成品罐接手{' '}
            {productionLogistics.initialSnapshot.outputJarReceiverSlots} 個 physical jars
            （背包 {productionLogistics.initialSnapshot.carriedOutputJarSlots} · rack{' '}
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
              展開 production logistics trace（{productionLogistics.actions.length} actions）
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
                    {action.snapshot.backpackSlotsAvailable} · 常駐罐{' '}
                    {action.snapshot.carriedJarSlots}
                    {action.snapshot.machineSlotsAvailable > 0
                      ? ' · machine ' +
                        action.snapshot.machineSlotsUsed +
                        '/' +
                        action.snapshot.machineSlotsAvailable
                      : ''}
                    {action.outputJarReceiver
                      ? ' · output → ' +
                        (action.outputJarReceiver === 'carried-jar'
                          ? '常駐 physical jar'
                          : 'jar-rack staging physical jar')
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
          實際使用 {plan.physicalJarsUsed} / {plan.carriedJuiceJarCount}{' '}
          個常駐攜帶果汁罐；單趟最多帶出 {plan.maxJuiceJarSlotsCarried} 個。
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
            ? ' 剩餘成品目前只保存於本次 planner result；跨日寫回 inventory 仍待 Apply Plan。'
            : ''}
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
              {trip.totalServings} 杯 · {trip.juiceJars.length} 罐
            </span>
          </div>
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
                果汁罐 {load.physicalJarId}：{load.recipeName} · 販售 {load.servings}{' '}
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
      {plan.leftoverJarContents.some(
        (item) => item.location !== 'sales-trip',
      ) && (
        <article className="optimizer-batch-card">
          <div>
            <strong>留在家中的剩餘成品</strong>
            <span>不增加今日顧客服務量</span>
          </div>
          {plan.leftoverJarContents
            .filter((item) => item.location !== 'sales-trip')
            .map((item) => (
              <p
                key={
                  plan.policy +
                  '-leftover-' +
                  item.physicalJarId +
                  '-' +
                  item.recipeId
                }
              >
                果汁罐 {item.physicalJarId}：{item.recipeName} ×{item.servings} 杯
                {' · '}
                {item.location === 'jar-rack'
                  ? '果汁罐架 staging'
                  : '未用於販售的 carried jar'}
              </p>
            ))}
        </article>
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
