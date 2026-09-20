export type StageId = 1 | 2

export type PreferenceKind = 'ingredient' | 'effect'

export interface Preference {
  kind: PreferenceKind
  value: string
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
  name: string
  stage: StageId
  salePrice: number
  ingredients: string[]
  effects: string[]
  equipment: string[]
}

export interface Ingredient {
  id: string
  name: string
  stage: StageId
  buyPrice: number
  effects: string[]
  seller: string
}

export interface Equipment {
  id: string
  name: string
  stage: StageId
  buyPrice?: number
  note?: string
}
