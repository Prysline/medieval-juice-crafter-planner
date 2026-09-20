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
  /** 網站使用的穩定名稱；順序敏感配方會把原料順序寫進名稱。 */
  name: string
  stage: StageId
  salePrice: number
  /** 原料順序具有語意；不同調味順序可能產生不同特性。 */
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
