export type StageId = 1 | 2

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
  villageId: 'east-harbor'
  satisfactionRequired: number
  preferences: Preference[]
  schedule?: ScheduleObservation[]
}

export interface Recipe {
  id: string
  /** Stable planner label. For order-sensitive recipes this is the ingredient sequence. */
  name: string
  stage: StageId
  salePrice: number
  /** Order is significant when the game produces different results by seasoning sequence. */
  ingredients: string[]
  effects: EffectValue[]
  equipment: string[]
}

export interface Ingredient {
  id: string
  name: string
  stage: StageId
  buyPrice: number
  effects: EffectValue[]
  seller: string
}

export interface Equipment {
  id: string
  name: string
  stage: StageId
  buyPrice?: number
  note?: string
}
