export type StageId = 1 | 2 | 3 | 4 | 5 | 6 | 7

export type ProgressMilestoneId =
  | 'opening'
  | 'seasoner-unlocked'
  | 'juice-jar-unlocked'
  | 'juicer-unlocked'
  | 'tranquil-fountain-unlocked'
  | 'juice-blender-unlocked'
  | 'advanced-tragic-washing-station-unlocked'
  | 'advanced-citrus-juicer-unlocked'

export type VillageId = 'east-harbor' | 'tranquil-fountain'

export type SatisfactionByVillage = Record<VillageId, number>

export type PreferenceKind = 'ingredient' | 'effect'

export interface Preference {
  kind: PreferenceKind
  value: string
}

export interface EffectValue {
  name: string
  value: number
}

export interface ScheduleObservation {
  type: 'leave_home' | 'outside_village_by' | 'return_village'
  approxTime: string
  note?: string
}

export interface Customer {
  id: string
  name: string
  occupation: string
  villageId: VillageId
  satisfactionRequired: number
  /** null 代表遊戲目前仍顯示「？」；不可解讀成沒有喜好。 */
  preferences: Preference[] | null
  schedule?: ScheduleObservation[]
}

export interface Recipe {
  id: string
  /** 網站使用的穩定名稱；順序敏感配方會把原料順序寫進名稱。 */
  name: string
  /**
   * 截圖直接觀察到的遊戲內顯示名。
   * 三原料以上名稱的預設規則為「最高特性 + 隨機詞彙」，因此這只是一次觀察值，
   * 不作為同一 sequence 的穩定 canonical identity。
   */
  observedDisplayName?: string
  unlockedAt: ProgressMilestoneId
  salePrice: number
  /** 原料順序具有語意；不同調味順序可能產生不同特性。 */
  ingredients: string[]
  effects: EffectValue[]
  equipment: string[]
}

export interface Ingredient {
  id: string
  name: string
  unlockedAt: ProgressMilestoneId
  buyPrice: number
  effects: EffectValue[]
  seller: string
}

export interface Equipment {
  id: string
  name: string
  unlockedAt: ProgressMilestoneId
  buyPrice?: number
  seller?: string
  note?: string
}

export interface ShopInventoryEntry {
  ingredientId: Ingredient['id']
  buyPrice: number
}

export interface ShopDefinition {
  id: string
  name: string
  villageId: VillageId
  unlockedAt: ProgressMilestoneId
  inventory: ShopInventoryEntry[]
}

export interface ProgressMilestoneDefinition {
  id: ProgressMilestoneId
  label: string
  summary: string
}

export interface VillageDefinition {
  id: VillageId
  name: string
  unlockedAt: ProgressMilestoneId
}

export interface StageUnlockRequirement {
  villageId?: VillageId
  satisfactionRequired?: number
  satisfactionByVillageRequired?: Partial<Record<VillageId, number>>
  formalCustomersRequired?: number
  formalCustomersByVillageRequired?: Partial<Record<VillageId, number>>
  action?: string
  timing?: string
}

export interface StageDefinition {
  id: StageId
  label: string
  summary: string
  unlockRequirement?: StageUnlockRequirement
  progressionNotes?: string[]
}


export type RecipeCandidateSource = 'observed' | 'personal' | 'computed'

export interface RecipeEffectAmbiguity {
  cutoffValue: number
  remainingSlots: number
  candidates: EffectValue[]
}

export interface RecipeCandidate {
  id: string
  /** observed 沿用攻略穩定名稱；computed 使用描述性名稱，不宣稱為遊戲內正式名稱。 */
  name: string
  /** observed 配方可帶出一次實測到的遊戲顯示名；不作為穩定 identity。 */
  observedDisplayName?: string
  source: RecipeCandidateSource
  unlockedAt: ProgressMilestoneId
  /** computed 售價尚未確認，必須維持 null。 */
  salePrice: number | null
  /** 原料順序具有語意。 */
  ingredients: string[]
  /** observed 為實測成品特性；computed ambiguous 時只放一定會入選的特性。 */
  effects: EffectValue[]
  /**
   * 套用「較晚加入原料優先」後，若 cutoff 仍同分且最後貢獻位置相同，
   * 列出剩餘候選，不自行發明次級 tie-break。
   */
  effectAmbiguity?: RecipeEffectAmbiguity
  equipment: string[]
  observedRecipeId?: Recipe['id']
}


export interface SavedRecipeConfirmedResult {
  /** 玩家已在遊戲內確認的最終成品特性 snapshot。 */
  effects: EffectValue[]
  /** 售價若未實測可維持 null；不從 computed 規則補值。 */
  salePrice: number | null
  confirmedAt: string
}

export interface SavedRecipe {
  id: string
  name: string
  ingredientIds: string[]
  note?: string
  createdAt: string
  /**
   * 只有存在 confirmedResult 的個人配方，才可作為 trusted optimizer evidence。
   * 舊資料沒有此欄仍保留，但只視為未確認的個人筆記。
   */
  confirmedResult?: SavedRecipeConfirmedResult
}

export type RecipeSequenceIssueCode =
  | 'empty'
  | 'unknown-ingredient'
  | 'invalid-base'
  | 'unsupported-ingredient'

export interface RecipeSequenceIssue {
  code: RecipeSequenceIssueCode
  message: string
  ingredientId?: string
}

export interface RecipeSequenceEvaluationSuccess {
  valid: true
  ingredientIds: string[]
  candidate: RecipeCandidate
  /**
   * 依完整有序原料序列累加後、尚未套用 slot cutoff 的全部特性總值。
   * 與 candidate.effects（實際／可確定成品特性）分開保存，供配方研究使用。
   */
  effectTotals: EffectValue[]
  cost: {
    batchIngredientCost: number | null
    unitIngredientCost: number | null
    missingIngredients: string[]
  }
  availableAtCurrentProgress: boolean
  /** 每個 juice-base 開啟一段飲料序列；多於一段代表需要果汁調和器串接。 */
  drinkSegmentCount: number
  usesBlender: boolean
}

export interface RecipeSequenceEvaluationFailure {
  valid: false
  ingredientIds: string[]
  issues: RecipeSequenceIssue[]
}

export type RecipeSequenceEvaluation =
  | RecipeSequenceEvaluationSuccess
  | RecipeSequenceEvaluationFailure


export interface JuiceJarInventoryItem {
  id: string
  /** null 代表空罐；非空罐只保存單一 final recipe identity。 */
  recipeId: string | null
  servings: number
}

export type IntermediateJuiceInventory = Record<string, number>

export interface InventoryState {
  /** 只保存原料總數量；stack 5 與實際裝載由 domain 規則計算。 */
  ingredientUnits: Record<string, number>
  /**
   * 以 canonical juice-state identity 為 key 保存尚未經果汁成品台的 juice units。
   * optional 只用來容納舊的 in-memory / persisted shape；storage normalize 後一定會補成 {}。
   * 不得把這些 key 當成 final recipeId。
   */
  intermediateJuiceUnits?: IntermediateJuiceInventory
  waterUnits: number
  /** clean + used = 玩家目前實際持有的杯具總數。 */
  cleanCups: number
  usedCups: number
  /** 每個 item 都代表一個實際 physical jar；空罐也保留 identity。 */
  juiceJars: JuiceJarInventoryItem[]
  /** 一般架子數；每架固定 9 slots。 */
  shelfCount: number
  /** 果汁罐架數；每架固定 5 slots。 */
  jarRackCount: number
}

export type JuiceJarCarryMode = 'auto' | 'fixed-slots'

export interface PlannerSettings {
  /**
   * auto：有果汁罐架時由規劃器逐趟決定要帶幾罐。
   * fixed-slots：固定保留指定數量的背包格給果汁罐，但不綁定 physical jar identity。
   * 沒有足夠果汁罐架空間時，實體罐的最低隨身數量仍是硬限制。
   */
  juiceJarCarryMode: JuiceJarCarryMode
  /** fixed-slots 模式下保留給果汁罐的背包格數，0～10。 */
  reservedJuiceJarSlots: number
  /** opt-in：接受背包滿時 used cup 可能掉落。 */
  allowUsedCupDropIfFull: boolean
  /**
   * opt-in：規劃器可在確有需要時倒掉既有果汁，釋放實體罐給其他配方。
   * 預設 false；不代表允許跨罐轉移果汁。
   */
  allowDiscardRetainedJuice: boolean
}
