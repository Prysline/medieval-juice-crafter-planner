import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  buildCustomSalesTripEditorDraft,
  clearEmptyCustomTripEditorDraftTrips,
  cloneCustomSalesTripPlan,
  customerIdsForCustomTripEditorDraft,
  mergeCustomSalesTripEditorDraftTrips,
  moveCustomTripEditorDraftCustomers,
  moveCustomTripEditorDraftCustomersToNewTrip,
  normalizeCustomSalesTripEditorDraft,
  removeEmptyCustomTripEditorDraftTrip,
  reorderCustomSalesTripEditorDraftTrips,
  swapCustomTripEditorDraftCustomers,
  type CustomSalesTripEditorDraft,
  type CustomSalesTripPlan,
} from './domain/customSalesTripPlan'
import type {
  CustomTripPhysicalIssue,
  CustomTripPhysicalValidationResult,
} from './domain/customTripPhysicalPlanner'
import {
  customerIdsInCanonicalResidenceOrder,
  customerResidencePresentationGroups,
  customerResidencePresentationLabel,
} from './presentationOrder'

interface CustomTripResidenceGroup {
  residenceId: string | null
  customerIds: string[]
}

interface CustomTripRegionGroup {
  regionId: string
  customerIds: string[]
  residences: CustomTripResidenceGroup[]
}

interface CustomTripRecipeGroup {
  recipeId: string
  customerIds: string[]
  regions: CustomTripRegionGroup[]
}

export interface CustomTripEditorTripGroup {
  tripId: string
  displayNumber: number
  customerIds: string[]
  recipes: CustomTripRecipeGroup[]
}

export function buildCustomTripEditorGroups(
  plan: CustomSalesTripEditorDraft,
): CustomTripEditorTripGroup[] {
  const residenceByCustomerId = Object.fromEntries(
    Object.entries(plan.customersById).map(([customerId, customer]) => [
      customerId,
      customer.residenceId ?? null,
    ]),
  )

  return plan.editorTripOrder.map((tripId, tripIndex) => {
    const customerIds = customerIdsForCustomTripEditorDraft(
      plan,
      tripId,
    )
    const recipeMap = new Map<string, string[]>()

    for (const customerId of customerIds) {
      const customer = plan.customersById[customerId]
      if (!customer) continue
      const ids = recipeMap.get(customer.recipeId) ?? []
      ids.push(customerId)
      recipeMap.set(customer.recipeId, ids)
    }

    const recipes = [...recipeMap.entries()].map(
      ([recipeId, recipeCustomerIds]) => {
        const regionMap = new Map<string, string[]>()
        for (const customerId of recipeCustomerIds) {
          const customer = plan.customersById[customerId]
          if (!customer) continue
          const ids = regionMap.get(customer.regionId) ?? []
          ids.push(customerId)
          regionMap.set(customer.regionId, ids)
        }

        return {
          recipeId,
          customerIds: recipeCustomerIds,
          regions: [...regionMap.entries()].map(
            ([regionId, regionCustomerIds]) => {
              const orderedCustomerIds =
                customerIdsInCanonicalResidenceOrder(
                  regionCustomerIds,
                  residenceByCustomerId,
                )

              return {
                regionId,
                customerIds: orderedCustomerIds,
                residences: customerResidencePresentationGroups(
                  orderedCustomerIds,
                  residenceByCustomerId,
                ),
              }
            },
          ),
        }
      },
    )

    return {
      tripId,
      displayNumber: tripIndex + 1,
      customerIds,
      recipes,
    }
  })
}

export function customTripPlanFingerprint(
  plan: CustomSalesTripPlan,
): string {
  return JSON.stringify({
    tripOrder: plan.tripOrder,
    tripByCustomerId: plan.tripByCustomerId,
    customers: Object.values(plan.customersById).map((customer) => ({
      customerId: customer.customerId,
      recipeId: customer.recipeId,
      servings: customer.servings,
      regionId: customer.regionId,
      residenceId: customer.residenceId ?? null,
      routeNodeId: customer.routeNodeId ?? null,
    })),
  })
}


export function customTripEditorDraftFingerprint(
  draft: CustomSalesTripEditorDraft,
): string {
  return JSON.stringify({
    editorTripOrder: draft.editorTripOrder,
    tripByCustomerId: draft.tripByCustomerId,
    customers: Object.values(draft.customersById).map((customer) => ({
      customerId: customer.customerId,
      recipeId: customer.recipeId,
      servings: customer.servings,
      regionId: customer.regionId,
      residenceId: customer.residenceId ?? null,
      routeNodeId: customer.routeNodeId ?? null,
    })),
  })
}

export function updatedCustomTripSelection(
  current: ReadonlySet<string>,
  customerIds: readonly string[],
  checked: boolean,
): Set<string> {
  const next = new Set(current)
  for (const customerId of customerIds) {
    if (checked) next.add(customerId)
    else next.delete(customerId)
  }
  return next
}

export function adjacentCustomTripIdForSelection(
  plan: CustomSalesTripEditorDraft,
  customerIds: readonly string[],
  direction: -1 | 1,
): string | null {
  if (customerIds.length === 0) return null

  let sourceTripId: string | null = null
  for (const customerId of customerIds) {
    const tripId = plan.tripByCustomerId[customerId]
    if (!tripId) return null
    if (sourceTripId && tripId !== sourceTripId) return null
    sourceTripId = tripId
  }

  if (!sourceTripId) return null
  const sourceIndex = plan.editorTripOrder.indexOf(sourceTripId)
  if (sourceIndex < 0) return null
  return plan.editorTripOrder[sourceIndex + direction] ?? null
}

export function moveCustomTripSelectionToAdjacentTrip(
  plan: CustomSalesTripEditorDraft,
  customerIds: readonly string[],
  direction: -1 | 1,
): CustomSalesTripPlan {
  const targetTripId = adjacentCustomTripIdForSelection(
    plan,
    customerIds,
    direction,
  )
  if (!targetTripId) return plan
  return moveCustomTripEditorDraftCustomers(
    plan,
    customerIds,
    targetTripId,
  )
}

export function swappableCustomTripCustomerPair(
  plan: CustomSalesTripEditorDraft,
  customerIds: readonly string[],
): readonly [string, string] | null {
  const uniqueCustomerIds = [...new Set(customerIds)]
  if (uniqueCustomerIds.length !== 2) return null

  const [firstCustomerId, secondCustomerId] = uniqueCustomerIds
  if (
    !plan.customersById[firstCustomerId] ||
    !plan.customersById[secondCustomerId]
  ) {
    return null
  }

  const firstTripId = plan.tripByCustomerId[firstCustomerId]
  const secondTripId = plan.tripByCustomerId[secondCustomerId]
  if (
    !firstTripId ||
    !secondTripId ||
    firstTripId === secondTripId
  ) {
    return null
  }

  return [firstCustomerId, secondCustomerId]
}

export interface CustomTripCustomerSwapAttempt {
  plan: CustomSalesTripEditorDraft
  validation: CustomTripPhysicalValidationResult | null
  applied: boolean
}

export function attemptCustomTripCustomerSwap(
  plan: CustomSalesTripEditorDraft,
  customerIds: readonly string[],
  validateDraft: (
    draft: CustomSalesTripPlan,
  ) => CustomTripPhysicalValidationResult,
): CustomTripCustomerSwapAttempt {
  const pair = swappableCustomTripCustomerPair(plan, customerIds)
  if (!pair) {
    return {
      plan,
      validation: null,
      applied: false,
    }
  }

  const candidate = swapCustomTripEditorDraftCustomers(
    plan,
    pair[0],
    pair[1],
  )
  const validation = validateDraft(
    normalizeCustomSalesTripEditorDraft(candidate),
  )
  if (validation.status === 'invalid') {
    return {
      plan,
      validation,
      applied: false,
    }
  }

  return {
    plan: candidate,
    validation,
    applied: true,
  }
}

function moveTripBefore(
  plan: CustomSalesTripEditorDraft,
  sourceTripId: string,
  targetTripId: string,
): CustomSalesTripPlan {
  if (
    sourceTripId === targetTripId ||
    !plan.editorTripOrder.includes(sourceTripId) ||
    !plan.editorTripOrder.includes(targetTripId)
  ) {
    return plan
  }

  const order = plan.editorTripOrder.filter(
    (tripId) => tripId !== sourceTripId,
  )
  const targetIndex = order.indexOf(targetTripId)
  order.splice(targetIndex, 0, sourceTripId)
  return reorderCustomSalesTripEditorDraftTrips(plan, order)
}

function swapTrip(
  plan: CustomSalesTripEditorDraft,
  tripId: string,
  direction: -1 | 1,
): CustomSalesTripPlan {
  const index = plan.editorTripOrder.indexOf(tripId)
  const targetIndex = index + direction
  if (
    index < 0 ||
    targetIndex < 0 ||
    targetIndex >= plan.editorTripOrder.length
  ) {
    return plan
  }

  const order = [...plan.editorTripOrder]
  ;[order[index], order[targetIndex]] = [
    order[targetIndex]!,
    order[index]!,
  ]
  return reorderCustomSalesTripEditorDraftTrips(plan, order)
}

function selectionState(
  selected: ReadonlySet<string>,
  customerIds: readonly string[],
): { checked: boolean; partial: boolean } {
  const selectedCount = customerIds.filter((customerId) =>
    selected.has(customerId),
  ).length
  return {
    checked:
      customerIds.length > 0 &&
      selectedCount === customerIds.length,
    partial:
      selectedCount > 0 &&
      selectedCount < customerIds.length,
  }
}

function IssueBlock({
  title,
  issues,
}: {
  title: string
  issues: readonly CustomTripPhysicalIssue[]
}) {
  if (issues.length === 0) return null
  return (
    <div className="optimizer-error" role="alert">
      <strong>{title}</strong>
      {issues.map((issue, index) => (
        <div key={issue.category + ':' + index}>
          <span>{issue.message}</span>
          {issue.suggestions.length > 0 && (
            <ul>
              {issue.suggestions.map((suggestion) => (
                <li key={suggestion}>{suggestion}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

type ValidationState =
  | { status: 'idle'; revision: number }
  | { status: 'checking'; revision: number }
  | {
      status: 'done'
      revision: number
      result: CustomTripPhysicalValidationResult
    }

export interface CustomSalesTripEditorProps {
  autoBaseline: CustomSalesTripPlan
  appliedPlan?: CustomSalesTripPlan | null
  validateDraft: (
    draft: CustomSalesTripPlan,
  ) => CustomTripPhysicalValidationResult
  customerLabel: (customerId: string) => string
  recipeLabel: (recipeId: string) => string
  regionLabel: (regionId: string) => string
  defaultOpen?: boolean
  applyError?: string | null
  onDraftDirtyChange?: (dirty: boolean) => void
  onRestoreAutoPlan?: () => void
  onAcceptValidatedDraft?: (
    draft: CustomSalesTripPlan,
    validation: Extract<
      CustomTripPhysicalValidationResult,
      { status: 'valid' }
    >,
  ) => void
}

export function CustomSalesTripEditor({
  autoBaseline,
  appliedPlan = null,
  validateDraft,
  customerLabel,
  recipeLabel,
  regionLabel,
  defaultOpen = false,
  applyError = null,
  onDraftDirtyChange,
  onRestoreAutoPlan,
  onAcceptValidatedDraft,
}: CustomSalesTripEditorProps) {
  const editingStartPlan = appliedPlan ?? autoBaseline
  const editingStartFingerprint = useMemo(
    () => customTripPlanFingerprint(editingStartPlan),
    [editingStartPlan],
  )
  const editingStartDraftFingerprint = useMemo(
    () =>
      customTripEditorDraftFingerprint(
        buildCustomSalesTripEditorDraft(editingStartPlan),
      ),
    [editingStartFingerprint, editingStartPlan],
  )
  const [open, setOpen] = useState(defaultOpen)
  const [draft, setDraft] = useState(() =>
    buildCustomSalesTripEditorDraft(editingStartPlan),
  )
  const [revision, setRevision] = useState(0)
  const revisionRef = useRef(0)
  revisionRef.current = revision
  const [validation, setValidation] =
    useState<ValidationState>(() => ({
      status: 'idle',
      revision: 0,
    }))
  const [selectedCustomerIds, setSelectedCustomerIds] =
    useState<Set<string>>(() => new Set())
  const [swapValidation, setSwapValidation] =
    useState<Extract<
      CustomTripPhysicalValidationResult,
      { status: 'invalid' }
    > | null>(null)
  const [moveTargetTripId, setMoveTargetTripId] = useState(
    autoBaseline.tripOrder[0] ?? '',
  )
  const [insertAfterTripId, setInsertAfterTripId] = useState(
    autoBaseline.tripOrder[0] ?? '',
  )
  const draggedCustomerIdsRef = useRef<string[]>([])
  const draggedTripIdRef = useRef<string | null>(null)
  const nextTripSequenceRef = useRef(1)

  useEffect(() => {
    setDraft(buildCustomSalesTripEditorDraft(editingStartPlan))
    setRevision(0)
    setValidation({ status: 'idle', revision: 0 })
    setSelectedCustomerIds(new Set())
    setSwapValidation(null)
    setMoveTargetTripId(editingStartPlan.tripOrder[0] ?? '')
    setInsertAfterTripId(editingStartPlan.tripOrder[0] ?? '')
    nextTripSequenceRef.current = 1
  }, [editingStartFingerprint, editingStartPlan])

  const draftFingerprint = useMemo(
    () => customTripEditorDraftFingerprint(draft),
    [draft],
  )
  const draftDirty =
    draftFingerprint !== editingStartDraftFingerprint
  const normalizedDraft = useMemo(
    () => normalizeCustomSalesTripEditorDraft(draft),
    [draft],
  )

  useEffect(() => {
    onDraftDirtyChange?.(draftDirty)
  }, [draftDirty, onDraftDirtyChange])

  useEffect(
    () => () => onDraftDirtyChange?.(false),
    [onDraftDirtyChange],
  )

  useEffect(() => {
    if (!draft.editorTripOrder.includes(moveTargetTripId)) {
      setMoveTargetTripId(draft.editorTripOrder[0] ?? '')
    }
    if (!draft.editorTripOrder.includes(insertAfterTripId)) {
      setInsertAfterTripId(draft.editorTripOrder[0] ?? '')
    }
  }, [
    draft.editorTripOrder,
    insertAfterTripId,
    moveTargetTripId,
  ])

  useEffect(() => {
    if (!open) return

    const validatingRevision = revision
    setValidation({
      status: 'checking',
      revision: validatingRevision,
    })
    const result = validateDraft(normalizedDraft)
    if (revisionRef.current !== validatingRevision) return
    setValidation({
      status: 'done',
      revision: validatingRevision,
      result,
    })
  }, [normalizedDraft, open, revision, validateDraft])

  const groups = useMemo(
    () => buildCustomTripEditorGroups(draft),
    [draft],
  )
  const emptyTripIds = useMemo(
    () =>
      groups
        .filter((trip) => trip.customerIds.length === 0)
        .map((trip) => trip.tripId),
    [groups],
  )
  const selectedIds = useMemo(
    () => [...selectedCustomerIds],
    [selectedCustomerIds],
  )
  const selectedPreviousTripId = useMemo(
    () => adjacentCustomTripIdForSelection(draft, selectedIds, -1),
    [draft, selectedIds],
  )
  const selectedNextTripId = useMemo(
    () => adjacentCustomTripIdForSelection(draft, selectedIds, 1),
    [draft, selectedIds],
  )
  const selectedSwapPair = useMemo(
    () => swappableCustomTripCustomerPair(draft, selectedIds),
    [draft, selectedIds],
  )
  const currentValidation =
    validation.status === 'done' &&
    validation.revision === revision
      ? validation.result
      : null
  const issues =
    currentValidation?.status === 'invalid'
      ? currentValidation.issues
      : []

  function applyDraft(next: CustomSalesTripEditorDraft) {
    if (next === draft) return
    setSwapValidation(null)
    setDraft(next)
    setRevision((current) => current + 1)
    setSelectedCustomerIds((current) => {
      const nextSelection = new Set<string>()
      for (const customerId of current) {
        if (next.customersById[customerId]) {
          nextSelection.add(customerId)
        }
      }
      return nextSelection
    })
  }

  function toggleSelection(
    customerIds: readonly string[],
    checked: boolean,
  ) {
    setSwapValidation(null)
    setSelectedCustomerIds((current) =>
      updatedCustomTripSelection(current, customerIds, checked),
    )
  }

  function moveSelectedToAdjacentTrip(direction: -1 | 1) {
    applyDraft(
      moveCustomTripSelectionToAdjacentTrip(
        draft,
        selectedIds,
        direction,
      ),
    )
  }

  function swapSelectedCustomers() {
    const attempt = attemptCustomTripCustomerSwap(
      draft,
      selectedIds,
      validateDraft,
    )
    if (!attempt.applied) {
      if (attempt.validation?.status === 'invalid') {
        setSwapValidation(attempt.validation)
      }
      return
    }

    applyDraft(attempt.plan)
  }

  function moveSelectedToExistingTrip() {
    if (
      selectedIds.length === 0 ||
      !moveTargetTripId
    ) {
      return
    }
    applyDraft(
      moveCustomTripEditorDraftCustomers(
        draft,
        selectedIds,
        moveTargetTripId,
      ),
    )
  }

  function moveSelectedToNewTrip() {
    if (
      selectedIds.length === 0 ||
      !insertAfterTripId
    ) {
      return
    }

    let newTripId = ''
    do {
      newTripId =
        'custom-trip-' + nextTripSequenceRef.current++
    } while (draft.editorTripOrder.includes(newTripId))

    applyDraft(
      moveCustomTripEditorDraftCustomersToNewTrip(
        draft,
        selectedIds,
        newTripId,
        insertAfterTripId,
      ),
    )
    setMoveTargetTripId(newTripId)
    setInsertAfterTripId(newTripId)
  }

  function resetToAutoBaseline() {
    setDraft(buildCustomSalesTripEditorDraft(autoBaseline))
    setRevision((current) => current + 1)
    setSelectedCustomerIds(new Set())
    setSwapValidation(null)
  }

  function renderCustomerRow(customerId: string) {
    return (
      <label
        className="optimizer-transaction-row optimizer-custom-resident-row"
        key={customerId}
        draggable
        onDragStart={(event) => {
          const ids = selectedCustomerIds.has(customerId)
            ? selectedIds
            : [customerId]
          draggedCustomerIdsRef.current = ids
          draggedTripIdRef.current = null
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => {
          draggedCustomerIdsRef.current = []
        }}
      >
        <input
          type="checkbox"
          checked={selectedCustomerIds.has(customerId)}
          aria-label={customerLabel(customerId) + '單人選取'}
          onChange={(event) =>
            toggleSelection(
              [customerId],
              event.target.checked,
            )
          }
        />
        <strong>{customerLabel(customerId)}</strong>
        <span>
          {draft.customersById[customerId]?.servings} 杯
        </span>
      </label>
    )
  }

  return (
    <section
      className="optimizer-result-section"
      aria-label="自訂販售趟次"
    >
      <div className="section-title">
        <strong>自訂販售趟次</strong>
        <span>
          {open
            ? '調整草稿 · 不改配方'
            : appliedPlan
              ? '目前使用自訂方案'
              : '以目前自動方案開始'}
        </span>
      </div>

      {!open ? (
        <>
          <p>
            可在不改變顧客配方的前提下，自行調整顧客要放在哪一趟與趟次順序。
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
          >
            {appliedPlan ? '編輯自訂趟次' : '開始自訂趟次'}
          </button>
        </>
      ) : (
        <>
          <p className="optimizer-boundary-note">
            {appliedPlan
              ? '目前已完成的自訂方案仍維持生效；此處修改的是新草稿，只有再次按「完成自訂」後才會替換目前方案。'
              : '這裡只編輯自訂草稿並檢查實體果汁罐、杯具與補裝是否可行；目前正式販售排程仍維持自動方案。'}
            搬走一趟最後一位居民後，空白趟只保留在編輯草稿；驗證與完成自訂前會先排除，不會送進實體排程。
          </p>

          <div className="optimizer-run-actions">
            <button
              type="button"
              onClick={resetToAutoBaseline}
            >
              將草稿還原為自動方案
            </button>
            {appliedPlan && onRestoreAutoPlan && (
              <button
                type="button"
                onClick={onRestoreAutoPlan}
              >
                改回自動方案
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setSelectedCustomerIds(new Set())
              }}
            >
              收合自訂編輯
            </button>
          </div>

          <div className="optimizer-result-note" role="status">
            <strong>
              {currentValidation?.status === 'valid'
                ? '自訂草稿可實現'
                : currentValidation?.status === 'invalid'
                  ? '自訂草稿目前不可實現'
                  : '正在檢查自訂草稿'}
            </strong>
            <span>
              草稿版本 {revision + 1}
              {draftDirty ? ' · 尚未完成自訂' : ' · 已與目前方案一致'}
              {emptyTripIds.length > 0
                ? ' · 空白趟 ' + emptyTripIds.length
                : ''}
              {currentValidation?.status === 'valid'
                ? ' · 實體排程 ' +
                  currentValidation.salesPlan.tripCount +
                  ' 趟'
                : ''}
            </span>
          </div>

          <IssueBlock
            title="整體自訂方案問題"
            issues={issues.filter((issue) => !issue.tripId)}
          />

          <section className="optimizer-batch-card optimizer-custom-resident-actions">
            <div>
              <strong>居民操作 · 已選擇 {selectedIds.length} 位</strong>
              <span>
                以下移動只影響目前選取居民；上一／下一趟只在選取居民都來自同一趟時可用；剛好選取兩位不同趟居民時可直接交換趟次
              </span>
            </div>
            <div className="optimizer-controls optimizer-custom-resident-controls">
              <button
                type="button"
                disabled={!selectedPreviousTripId}
                onClick={() => moveSelectedToAdjacentTrip(-1)}
              >
                移到上一趟
              </button>
              <button
                type="button"
                disabled={!selectedNextTripId}
                onClick={() => moveSelectedToAdjacentTrip(1)}
              >
                移到下一趟
              </button>
              <button
                type="button"
                disabled={!selectedSwapPair}
                onClick={swapSelectedCustomers}
              >
                交換兩人的趟次
              </button>
              <label>
                <span>指定趟次</span>
                <select
                  value={moveTargetTripId}
                  onChange={(event) =>
                    setMoveTargetTripId(event.target.value)
                  }
                >
                  {draft.editorTripOrder.map((tripId, index) => (
                    <option key={tripId} value={tripId}>
                      第 {index + 1} 趟
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={moveSelectedToExistingTrip}
              >
                移到指定趟
              </button>
              <label>
                <span>新趟插入位置</span>
                <select
                  value={insertAfterTripId}
                  onChange={(event) =>
                    setInsertAfterTripId(event.target.value)
                  }
                >
                  {draft.editorTripOrder.map((tripId, index) => (
                    <option key={tripId} value={tripId}>
                      第 {index + 1} 趟之後
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={moveSelectedToNewTrip}
              >
                移到新趟
              </button>
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={() => {
                  setSelectedCustomerIds(new Set())
                  setSwapValidation(null)
                }}
              >
                清除選取
              </button>
              <button
                type="button"
                disabled={emptyTripIds.length === 0}
                onClick={() =>
                  applyDraft(
                    clearEmptyCustomTripEditorDraftTrips(draft),
                  )
                }
              >
                清除所有空白趟
              </button>
            </div>
            <IssueBlock
              title="兩位居民交換不可實現"
              issues={swapValidation?.issues ?? []}
            />
          </section>

          <div className="optimizer-batch-list optimizer-custom-trip-grid">
            {groups.map((trip, tripIndex) => {
              const tripIssues = issues.filter(
                (issue) =>
                  issue.tripId === trip.tripId &&
                  !issue.recipeId,
              )
              return (
                <article
                  className="optimizer-batch-card optimizer-custom-trip-card"
                  key={trip.tripId}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    const draggedCustomers =
                      draggedCustomerIdsRef.current
                    if (draggedCustomers.length > 0) {
                      applyDraft(
                        moveCustomTripEditorDraftCustomers(
                          draft,
                          draggedCustomers,
                          trip.tripId,
                        ),
                      )
                      draggedCustomerIdsRef.current = []
                      return
                    }
                    const sourceTripId =
                      draggedTripIdRef.current
                    if (sourceTripId) {
                      applyDraft(
                        moveTripBefore(
                          draft,
                          sourceTripId,
                          trip.tripId,
                        ),
                      )
                      draggedTripIdRef.current = null
                    }
                  }}
                >
                  <div>
                    <strong>第 {trip.displayNumber} 趟</strong>
                    <span>{trip.customerIds.length} 位顧客</span>
                  </div>

                  <div className="optimizer-run-actions">
                    <span
                      draggable
                      onDragStart={(event) => {
                        draggedTripIdRef.current = trip.tripId
                        draggedCustomerIdsRef.current = []
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragEnd={() => {
                        draggedTripIdRef.current = null
                      }}
                    >
                      整趟操作 · 拖曳整趟調整順序
                    </span>
                    <button
                      type="button"
                      disabled={tripIndex === 0}
                      onClick={() =>
                        applyDraft(
                          swapTrip(draft, trip.tripId, -1),
                        )
                      }
                    >
                      與上一趟交換
                    </button>
                    <button
                      type="button"
                      disabled={
                        tripIndex === groups.length - 1
                      }
                      onClick={() =>
                        applyDraft(
                          swapTrip(draft, trip.tripId, 1),
                        )
                      }
                    >
                      與下一趟交換
                    </button>
                    <button
                      type="button"
                      disabled={tripIndex === 0}
                      onClick={() =>
                        applyDraft(
                          mergeCustomSalesTripEditorDraftTrips(
                            draft,
                            trip.tripId,
                            draft.editorTripOrder[tripIndex - 1]!,
                          ),
                        )
                      }
                    >
                      併入上一趟
                    </button>
                    <button
                      type="button"
                      disabled={
                        tripIndex === groups.length - 1
                      }
                      onClick={() =>
                        applyDraft(
                          mergeCustomSalesTripEditorDraftTrips(
                            draft,
                            trip.tripId,
                            draft.editorTripOrder[tripIndex + 1]!,
                          ),
                        )
                      }
                    >
                      併入下一趟
                    </button>
                    <button
                      type="button"
                      disabled={trip.customerIds.length !== 0}
                      onClick={() =>
                        applyDraft(
                          removeEmptyCustomTripEditorDraftTrip(
                            draft,
                            trip.tripId,
                          ),
                        )
                      }
                    >
                      移除此空白趟
                    </button>
                  </div>

                  <IssueBlock
                    title={'第 ' + trip.displayNumber + ' 趟問題'}
                    issues={tripIssues}
                  />

                  {trip.customerIds.length === 0 && (
                    <p className="optimizer-boundary-note">
                      此趟目前空白，可將居民移入或移除此空白趟；它只存在於編輯草稿。
                    </p>
                  )}

                  {trip.recipes.map((recipe) => {
                    const recipeState = selectionState(
                      selectedCustomerIds,
                      recipe.customerIds,
                    )
                    const recipeIssues = issues.filter(
                      (issue) =>
                        issue.tripId === trip.tripId &&
                        issue.recipeId === recipe.recipeId,
                    )
                    return (
                      <section
                        className="optimizer-transaction-card optimizer-custom-recipe-card"
                        key={recipe.recipeId}
                      >
                        <div className="optimizer-transaction-card-heading">
                          <label>
                            <input
                              type="checkbox"
                              checked={recipeState.checked}
                              aria-checked={
                                recipeState.partial
                                  ? 'mixed'
                                  : recipeState.checked
                              }
                              onChange={(event) =>
                                toggleSelection(
                                  recipe.customerIds,
                                  event.target.checked,
                                )
                              }
                            />
                            <strong>
                              {recipeLabel(recipe.recipeId)}
                            </strong>
                          </label>
                          <span>
                            {recipe.customerIds.length} 杯
                          </span>
                        </div>

                        <IssueBlock
                          title={
                            recipeLabel(recipe.recipeId) +
                            ' 配方問題'
                          }
                          issues={recipeIssues}
                        />

                        {recipe.regions.map((region) => {
                          const regionState = selectionState(
                            selectedCustomerIds,
                            region.customerIds,
                          )
                          return (
                            <div
                              className="optimizer-transaction-list optimizer-custom-region-group"
                              key={region.regionId}
                            >
                              <label>
                                <input
                                  type="checkbox"
                                  checked={regionState.checked}
                                  aria-checked={
                                    regionState.partial
                                      ? 'mixed'
                                      : regionState.checked
                                  }
                                  onChange={(event) =>
                                    toggleSelection(
                                      region.customerIds,
                                      event.target.checked,
                                    )
                                  }
                                />
                                <strong>
                                  {regionLabel(region.regionId)}
                                </strong>
                                <span>
                                  {region.customerIds.length} 位
                                </span>
                              </label>

                              {region.residences.map(
                                (residence, residenceIndex) => {
                                  const residenceLabel =
                                    customerResidencePresentationLabel(
                                      residence.residenceId,
                                    )
                                  if (!residenceLabel) {
                                    return residence.customerIds.map(
                                      renderCustomerRow,
                                    )
                                  }

                                  const residenceState = selectionState(
                                    selectedCustomerIds,
                                    residence.customerIds,
                                  )

                                  return (
                                    <details
                                      className="optimizer-custom-residence-group"
                                      open
                                      key={
                                        region.regionId +
                                        '-' +
                                        (residence.residenceId ??
                                          residenceIndex)
                                      }
                                    >
                                      <summary>
                                        <label
                                          onClick={(event) =>
                                            event.stopPropagation()
                                          }
                                        >
                                          <input
                                            type="checkbox"
                                            checked={
                                              residenceState.checked
                                            }
                                            aria-checked={
                                              residenceState.partial
                                                ? 'mixed'
                                                : residenceState.checked
                                            }
                                            aria-label={
                                              residenceLabel +
                                              '整組選取'
                                            }
                                            onChange={(event) =>
                                              toggleSelection(
                                                residence.customerIds,
                                                event.target.checked,
                                              )
                                            }
                                          />
                                          <strong>
                                            {residenceLabel}
                                          </strong>
                                        </label>
                                        <span>
                                          {residence.customerIds.length} 位
                                        </span>
                                      </summary>
                                      <div className="optimizer-custom-residence-members">
                                        {residence.customerIds.map(
                                          renderCustomerRow,
                                        )}
                                      </div>
                                    </details>
                                  )
                                },
                              )}
                            </div>
                          )
                        })}
                      </section>
                    )
                  })}
                </article>
              )
            })}
          </div>

          {applyError && (
            <p className="optimizer-transaction-warning" role="alert">
              自訂趟次操作失敗：{applyError}
            </p>
          )}

          {onAcceptValidatedDraft && (
            <button
              type="button"
              className="optimizer-run-button"
              disabled={
                currentValidation?.status !== 'valid'
              }
              onClick={() => {
                if (currentValidation?.status !== 'valid') return
                onAcceptValidatedDraft(
                  cloneCustomSalesTripPlan(normalizedDraft),
                  currentValidation,
                )
              }}
            >
              完成自訂
            </button>
          )}
        </>
      )}
    </section>
  )
}
