import type { StageDefinition } from '../types'

export const stages: StageDefinition[] = [
  {
    id: 1,
    label: '階段一',
    summary: '柑橘榨汁機、檸檬與橙子的基礎果汁。',
  },
  {
    id: 2,
    label: '階段二',
    summary: '爺爺回信解鎖調味器，並解鎖薄荷與糖。',
  },
  {
    id: 3,
    label: '階段三',
    summary: '東港村滿意度 120、正式顧客 14 人以上後寄信；隔天回信解鎖果汁罐購買。',
    unlockRequirement: {
      villageId: 'east-harbor',
      satisfactionRequired: 120,
      formalCustomersRequired: 14,
      action: '寄信給爺爺',
      timing: '隔天收信後解鎖',
    },
  },
  {
    id: 4,
    label: '階段四',
    summary: '東港村滿意度 220、正式顧客 17 人以上後寄信；隔天回信解鎖榨汁機、紅蘿蔔與梨。',
    unlockRequirement: {
      villageId: 'east-harbor',
      satisfactionRequired: 220,
      formalCustomersRequired: 17,
      action: '寄信給爺爺',
      timing: '隔天收信後解鎖',
    },
  },
]
