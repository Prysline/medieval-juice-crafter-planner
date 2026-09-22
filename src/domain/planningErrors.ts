export type PlanningUserErrorCode =
  | 'missing-physical-jar'
  | 'missing-physical-cup'
  | 'jar-storage-overflow'
  | 'missing-jar-slot'
  | 'trip-capacity'
  | 'leftover-storage'
  | 'retained-juice-conflict'
  | 'jar-schedule-inconsistency'
  | 'optimizer-no-solution'

export interface PlanningUserErrorContext {
  remainingServings?: number
  requiredTerminalJarCount?: number
  reusableTerminalJarCount?: number
  retainedJarCount?: number
  policy?: string
  expectedJarTypeSwitches?: number
  actualJarTypeSwitches?: number
  solverStatus?: string
}

export class PlanningUserError extends Error {
  readonly code: PlanningUserErrorCode
  readonly context: PlanningUserErrorContext

  constructor(
    code: PlanningUserErrorCode,
    context: PlanningUserErrorContext = {},
    technicalMessage?: string,
  ) {
    super(technicalMessage ?? code)
    this.name = 'PlanningUserError'
    this.code = code
    this.context = context
  }
}

export interface PlanningErrorPresentation {
  title: string
  message: string
  suggestions: string[]
  technicalDetails?: string
}

function technicalDetails(error: unknown): string | undefined {
  if (error instanceof Error) return error.message
  if (typeof error === 'string' && error.trim()) return error.trim()
  return undefined
}

export function presentPlanningError(
  error: unknown,
): PlanningErrorPresentation {
  if (error instanceof PlanningUserError) {
    const details = technicalDetails(error)

    switch (error.code) {
      case 'missing-physical-jar':
        return {
          title: '沒有可用的果汁罐',
          message: '目前沒有實際持有的果汁罐，無法安排販售。',
          suggestions: ['先在庫存中設定至少 1 個實體果汁罐。'],
          technicalDetails: details,
        }
      case 'missing-physical-cup':
        return {
          title: '沒有可用的杯子',
          message: '目前沒有任何乾淨或用過的實體杯，無法安排顧客服務。',
          suggestions: [
            '先在庫存中設定至少 1 個實體杯。',
            '若只有用過的杯子，規劃器會在可行時安排回家清洗。',
          ],
          technicalDetails: details,
        }
      case 'jar-storage-overflow':
        return {
          title: '果汁罐沒有合法存放位置',
          message:
            '目前持有的果汁罐數量超過果汁罐架與 10 格背包合計可容納的數量。',
          suggestions: [
            '增加果汁罐架容量。',
            '確認庫存中的實體果汁罐數量是否填寫正確。',
          ],
          technicalDetails: details,
        }
      case 'missing-jar-slot':
        return {
          title: '沒有可用的果汁罐格',
          message: '目前設定沒有留下任何可供販售使用的果汁罐格。',
          suggestions: [
            '改用「每趟自動計算」。',
            '或把固定果汁罐格數調成至少 1 格。',
          ],
          technicalDetails: details,
        }
      case 'trip-capacity':
        return {
          title: '這組杯具與背包空間排不出販售趟次',
          message:
            '目前的果汁罐格、杯子數量與用過杯處理方式，無法讓剩餘需求在 10 格背包內完成。',
          suggestions: [
            '若已有果汁罐架，可改用「每趟自動計算」或減少固定果汁罐格數。',
            '增加實體杯數，讓每趟可服務更多顧客。',
            '如果能接受杯子掉落，可開啟背包滿時允許掉落用過杯的選項。',
          ],
          technicalDetails: details,
        }
      case 'leftover-storage': {
        const remaining = error.context.remainingServings
        const required = error.context.requiredTerminalJarCount
        const reusable = error.context.reusableTerminalJarCount
        const retained = error.context.retainedJarCount
        const capacityDetail =
          typeof required === 'number' && typeof reusable === 'number'
            ? `這份規劃有 ${required} 種不同配方需要在販售結束後各自保留成品，因此需要至少 ${required} 個可作終局容器的實體果汁罐；目前只有 ${reusable} 個可重用。`
            : ''
        const additional =
          typeof required === 'number' && typeof reusable === 'number'
            ? Math.max(0, required - reusable)
            : undefined
        const retainedDetail =
          typeof retained === 'number' && retained > 0
            ? `另有 ${retained} 個果汁罐因既有內容必須保留，不能拿來換裝其他配方。`
            : ''
        const additionalDetail =
          typeof additional === 'number' && additional > 0
            ? `在不倒掉既有果汁的前提下，還需要至少 ${additional} 個可用果汁罐。`
            : ''

        return {
          title: '剩餘果汁沒有足夠的實體罐可保留',
          message: [
            capacityDetail,
            retainedDetail,
            additionalDetail,
            remaining && remaining > 0
              ? `目前仍有 ${remaining} 杯剩餘果汁無法安排合法終局容器。`
              : '目前仍有剩餘果汁無法安排合法終局容器。',
          ]
            .filter(Boolean)
            .join(' '),
          suggestions: [
            '不同配方的剩餘果汁不能共用同一個未空果汁罐；請先比較「需要的終局罐數」與「可重用罐數」。',
            '增加實體果汁罐，直到可重用罐數達到終局需求；或調整既有果汁罐內容，讓更多罐可在當天結束時留給新配方。',
            retained && retained > 0
              ? '如果這些既有果汁可以丟棄，可勾選「必要時允許倒掉既有果汁以騰出果汁罐」；規劃器只會倒掉實際需要釋放的罐。'
              : '若不想增加果汁罐，可改用會產生較少不同剩餘配方的規劃條件。',
          ],
          technicalDetails: details,
        }
      }
      case 'retained-juice-conflict':
        return {
          title: '現有果汁內容阻止了換裝',
          message:
            '目前需要保留的既有果汁尚未喝完，不能為了安排其他配方而自動倒掉或跨罐轉移。',
          suggestions: [
            '增加實體果汁罐。',
            '調整初始果汁罐內容，或減少需要同時使用的不同果汁種類。',
            '如果目前罐內果汁可以丟棄，可勾選「必要時允許倒掉既有果汁以騰出果汁罐」；此選項預設關閉。',
          ],
          technicalDetails: details,
        }
      case 'jar-schedule-inconsistency': {
        const expected = error.context.expectedJarTypeSwitches
        const actual = error.context.actualJarTypeSwitches
        const detail =
          typeof expected === 'number' && typeof actual === 'number'
            ? `最佳化預期 ${expected} 次換裝，但實體排程產生 ${actual} 次。`
            : '最佳化結果與實體果汁罐排程的換裝次數不一致。'

        return {
          title: '果汁罐排程發生內部不一致',
          message:
            `${detail} 這是網站內部規劃錯誤，不是庫存輸入本身能修正的問題。`,
          suggestions: [
            '可保留目前庫存與規劃設定，將下方技術資訊提供給網站除錯。',
            '不需要反覆修改庫存來嘗試避開這個錯誤。',
          ],
          technicalDetails: details,
        }
      }
      case 'optimizer-no-solution':
        return {
          title: '目前條件找不到可行的批次規劃',
          message:
            '求解器無法在目前的顧客、候選配方與限制條件下找到完整可行方案。',
          suggestions: [
            '放寬最大果汁罐換裝次數等限制。',
            '確認目前主線進度、候選配方政策與庫存設定是否符合實際狀態。',
          ],
          technicalDetails: details,
        }
    }
  }

  return {
    title: '規劃處理發生問題',
    message:
      '目前無法安全完成這次規劃或套用操作。請重新確認設定後再試；若持續發生，可查看下方技術資訊協助除錯。',
    suggestions: ['確認庫存與規劃設定後重新執行。'],
    technicalDetails: technicalDetails(error),
  }
}
