import type { Equipment } from '../types'

export const equipment: Equipment[] = [
  {
    id: 'citrus-juicer',
    name: '柑橘榨汁機',
    stage: 1,
    buyPrice: 300,
    seller: '木匠',
    note: '橙子或檸檬 1:1 製成果汁原汁。',
  },
  {
    id: 'finished-juice-station',
    name: '果汁成品台',
    stage: 1,
    buyPrice: 500,
    seller: '木匠',
    note: '果汁原汁 ×1 + 水 ×1 → 成品 ×2。',
  },
  {
    id: 'tragic-washing-station',
    name: '悲劇清洗台',
    stage: 1,
    buyPrice: 300,
    seller: '木匠',
    note: '用過的悲劇 ×1 + 水 ×1 → 乾淨悲劇 ×1。',
  },
  {
    id: 'seasoner',
    name: '調味器',
    stage: 2,
    buyPrice: 300,
    seller: '木匠',
    note: '主線寄信給爺爺後睡一覺，隔天收到回信解鎖。',
  },
  {
    id: 'juice-jar',
    name: '果汁罐',
    stage: 3,
    buyPrice: 300,
    seller: '錫匠',
    note: '東港村滿意度 120、正式顧客 14 人以上後寄信給爺爺；隔天收信後解鎖購買。',
  },
  {
    id: 'juicer',
    name: '榨汁機',
    stage: 4,
    buyPrice: 400,
    seller: '木匠',
    note: '東港村滿意度 220、正式顧客 17 人以上後寄信給爺爺；隔天收信後解鎖。',
  },
]
