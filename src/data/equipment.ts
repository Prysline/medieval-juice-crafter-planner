import type { Equipment } from '../types'

export const equipment: Equipment[] = [
  {
    id: 'citrus-juicer',
    name: '柑橘榨汁機',
    stage: 1,
    buyPrice: 300,
    note: '橙子或檸檬 1:1 製成果汁原汁。',
  },
  {
    id: 'finished-juice-station',
    name: '果汁成品台',
    stage: 1,
    buyPrice: 500,
    note: '果汁原汁 ×1 + 水 ×1 → 成品 ×2。',
  },
  {
    id: 'tragic-washing-station',
    name: '悲劇清洗台',
    stage: 1,
    buyPrice: 300,
    note: '用過的悲劇 ×1 + 水 ×1 → 乾淨悲劇 ×1。',
  },
  {
    id: 'seasoner',
    name: '調味器',
    stage: 2,
    buyPrice: 300,
    note: '主線寄信給爺爺後睡一覺，隔天收到回信解鎖。',
  },
]
