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
  /** cutoff 同分且 slot 不足時列出所有候選，不自行選 tie-break。 */
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
  | 'too-many-ingredients'
  | 'unknown-ingredient'
  | 'invalid-base'
  | 'invalid-seasoning'
  | 'duplicate-ingredient'

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
}

export interface RecipeSequenceEvaluationFailure {
  valid: false
  ingredientIds: string[]
  issues: RecipeSequenceIssue[]
}

export type RecipeSequenceEvaluation =
  | RecipeSequenceEvaluationSuccess
  | RecipeSequenceEvaluationFailure
