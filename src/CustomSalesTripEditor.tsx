import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  cloneCustomSalesTripPlan,
  customerIdsForCustomTrip,
  mergeCustomSalesTrips,
  moveCustomTripCustomers,
  moveCustomTripCustomersToNewTrip,
  reorderCustomSalesTrips,
  type CustomSalesTripPlan,
} from './domain/customSalesTripPlan'
import type {
  CustomTripPhysicalIssue,
  CustomTripPhysicalValidationResult,
} from './domain/customTripPhysicalPlanner'
import { customerIdsInCanonicalResidenceOrder } from './presentationOrder'

interface CustomTripRegionGroup {
  regionId: string
  customerIds: string[]
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
  plan: CustomSalesTripPlan,
): CustomTripEditorTripGroup[] {
  const residenceByCustomerId = Object.fromEntries(
    Object.entries(plan.customersById).map(([customerId, customer]) => [
      customerId,
      customer.residenceId ?? null,
    ]),
  )

  return plan.tripOrder.map((tripId, tripIndex) => {
    const customerIds = customerIdsForCustomTrip(plan, tripId)
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
            ([regionId, regionCustomerIds]) => ({
              regionId,
              customerIds: customerIdsInCanonicalResidenceOrder(
                regionCustomerIds,
                residenceByCustomerId,
              ),
            }),
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

function moveTripBefore(
  plan: CustomSalesTripPlan,
  sourceTripId: string,
  targetTripId: string,
): CustomSalesTripPlan {
  if (
    sourceTripId === targetTripId ||
    !plan.tripOrder.includes(sourceTripId) ||
    !plan.tripOrder.includes(targetTripId)
  ) {
    return plan
  }

  const order = plan.tripOrder.filter(
    (tripId) => tripId !== sourceTripId,
  )
  const targetIndex = order.indexOf(targetTripId)
  order.splice(targetIndex, 0, sourceTripId)
  return reorderCustomSalesTrips(plan, order)
}

function swapTrip(
  plan: CustomSalesTripPlan,
  tripId: string,
  direction: -1 | 1,
): CustomSalesTripPlan {
  const index = plan.tripOrder.indexOf(tripId)
  const targetIndex = index + direction
  if (
    index < 0 ||
    targetIndex < 0 ||
    targetIndex >= plan.tripOrder.length
  ) {
    return plan
  }

  const order = [...plan.tripOrder]
  ;[order[index], order[targetIndex]] = [
    order[targetIndex]!,
    order[index]!,
  ]
  return reorderCustomSalesTrips(plan, order)
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
  const [open, setOpen] = useState(defaultOpen)
  const [draft, setDraft] = useState(() =>
    cloneCustomSalesTripPlan(editingStartPlan),
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
    setDraft(cloneCustomSalesTripPlan(editingStartPlan))
    setRevision(0)
    setValidation({ status: 'idle', revision: 0 })
    setSelectedCustomerIds(new Set())
    setMoveTargetTripId(editingStartPlan.tripOrder[0] ?? '')
    setInsertAfterTripId(editingStartPlan.tripOrder[0] ?? '')
    nextTripSequenceRef.current = 1
  }, [editingStartFingerprint, editingStartPlan])

  const draftFingerprint = useMemo(
    () => customTripPlanFingerprint(draft),
    [draft],
  )
  const draftDirty =
    draftFingerprint !== editingStartFingerprint

  useEffect(() => {
    onDraftDirtyChange?.(draftDirty)
  }, [draftDirty, onDraftDirtyChange])

  useEffect(
    () => () => onDraftDirtyChange?.(false),
    [onDraftDirtyChange],
  )

  useEffect(() => {
    if (!draft.tripOrder.includes(moveTargetTripId)) {
      setMoveTargetTripId(draft.tripOrder[0] ?? '')
    }
    if (!draft.tripOrder.includes(insertAfterTripId)) {
      setInsertAfterTripId(draft.tripOrder[0] ?? '')
    }
  }, [draft.tripOrder, insertAfterTripId, moveTargetTripId])

  useEffect(() => {
    if (!open) return

    const validatingRevision = revision
    setValidation({
      status: 'checking',
      revision: validatingRevision,
    })
    const result = validateDraft(draft)
    if (revisionRef.current !== validatingRevision) return
    setValidation({
      status: 'done',
      revision: validatingRevision,
      result,
    })
  }, [draft, open, revision, validateDraft])

  const groups = useMemo(
    () => buildCustomTripEditorGroups(draft),
    [draft],
  )
  const selectedIds = useMemo(
    () => [...selectedCustomerIds],
    [selectedCustomerIds],
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

  function applyDraft(next: CustomSalesTripPlan) {
    if (next === draft) return
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
    setSelectedCustomerIds((current) => {
      const next = new Set(current)
      for (const customerId of customerIds) {
        if (checked) next.add(customerId)
        else next.delete(customerId)
      }
      return next
    })
  }

  function moveSelectedToExistingTrip() {
    if (
      selectedIds.length === 0 ||
      !moveTargetTripId
    ) {
      return
    }
    applyDraft(
      moveCustomTripCustomers(
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
    } while (draft.tripOrder.includes(newTripId))

    applyDraft(
      moveCustomTripCustomersToNewTrip(
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
    setDraft(cloneCustomSalesTripPlan(autoBaseline))
    setRevision((current) => current + 1)
    setSelectedCustomerIds(new Set())
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

          <section className="optimizer-batch-card">
            <div>
              <strong>已選擇 {selectedIds.length} 位顧客</strong>
              <span>手機可直接用下方移動控制</span>
            </div>
            <div className="optimizer-controls">
              <label>
                <span>移到既有趟次</span>
                <select
                  value={moveTargetTripId}
                  onChange={(event) =>
                    setMoveTargetTripId(event.target.value)
                  }
                >
                  {draft.tripOrder.map((tripId, index) => (
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
                移到選定趟
              </button>
              <label>
                <span>新趟插入位置</span>
                <select
                  value={insertAfterTripId}
                  onChange={(event) =>
                    setInsertAfterTripId(event.target.value)
                  }
                >
                  {draft.tripOrder.map((tripId, index) => (
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
                onClick={() =>
                  setSelectedCustomerIds(new Set())
                }
              >
                清除選取
              </button>
            </div>
          </section>

          <div className="optimizer-batch-list">
            {groups.map((trip, tripIndex) => {
              const tripIssues = issues.filter(
                (issue) =>
                  issue.tripId === trip.tripId &&
                  !issue.recipeId,
              )
              return (
                <article
                  className="optimizer-batch-card"
                  key={trip.tripId}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    const draggedCustomers =
                      draggedCustomerIdsRef.current
                    if (draggedCustomers.length > 0) {
                      applyDraft(
                        moveCustomTripCustomers(
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
                      拖曳調整趟次順序
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
                      上移
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
                      下移
                    </button>
                    <button
                      type="button"
                      disabled={tripIndex === 0}
                      onClick={() =>
                        applyDraft(
                          mergeCustomSalesTrips(
                            draft,
                            trip.tripId,
                            draft.tripOrder[tripIndex - 1]!,
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
                          mergeCustomSalesTrips(
                            draft,
                            trip.tripId,
                            draft.tripOrder[tripIndex + 1]!,
                          ),
                        )
                      }
                    >
                      併入下一趟
                    </button>
                  </div>

                  <IssueBlock
                    title={'第 ' + trip.displayNumber + ' 趟問題'}
                    issues={tripIssues}
                  />

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
                        className="optimizer-transaction-card"
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
                              className="optimizer-transaction-list"
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

                              {region.customerIds.map(
                                (customerId) => (
                                  <label
                                    className="optimizer-transaction-row"
                                    key={customerId}
                                    draggable
                                    onDragStart={(event) => {
                                      const ids =
                                        selectedCustomerIds.has(
                                          customerId,
                                        )
                                          ? selectedIds
                                          : [customerId]
                                      draggedCustomerIdsRef.current = ids
                                      draggedTripIdRef.current = null
                                      event.dataTransfer.effectAllowed =
                                        'move'
                                    }}
                                    onDragEnd={() => {
                                      draggedCustomerIdsRef.current = []
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedCustomerIds.has(
                                        customerId,
                                      )}
                                      onChange={(event) =>
                                        toggleSelection(
                                          [customerId],
                                          event.target.checked,
                                        )
                                      }
                                    />
                                    <strong>
                                      {customerLabel(customerId)}
                                    </strong>
                                    <span>
                                      {
                                        draft.customersById[customerId]
                                          ?.servings
                                      } 杯
                                    </span>
                                  </label>
                                ),
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
                  cloneCustomSalesTripPlan(draft),
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
