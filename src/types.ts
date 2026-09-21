export type StageId = 1 | 2 | 3 | 4 | 5

export type ProgressMilestoneId =
  | 'opening'
  | 'seasoner-unlocked'
  | 'juice-jar-unlocked'
  | 'juicer-unlocked'
  | 'tranquil-fountain-unlocked'
  | 'juice-blender-unlocked'

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
  villageId: VillageId
  satisfactionRequired?: number
  formalCustomersRequired?: number
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


export type RecipeCandidateSource = 'observed' | 'computed'

export interface RecipeEffectAmbiguity {
  cutoffValue: number
  remainingSlots: number
  candidates: EffectValue[]
}

export interface RecipeCandidate {
  id: string
  /** observed 沿用攻略穩定名稱；computed 使用描述性名稱，不宣稱為遊戲內正式名稱。 */
  name: string
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


export interface SavedRecipe {
  id: string
  name: string
  ingredientIds: string[]
  note?: string
  createdAt: string
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
  /** null 代表空罐；非空罐只保存單一 recipe identity。 */
  recipeId: string | null
  servings: number
}

export interface InventoryState {
  /** 只保存原料總數量；stack 5 與實際裝載由 domain 規則計算。 */
  ingredientUnits: Record<string, number>
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

export interface PlannerSettings {
  /** 本次規劃明確選中的常駐 physical juice jar identities。 */
  carriedJuiceJarIds: string[]
  /** opt-in：接受背包滿時 used cup 可能掉落。 */
  allowUsedCupDropIfFull: boolean
}
