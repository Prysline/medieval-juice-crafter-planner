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
