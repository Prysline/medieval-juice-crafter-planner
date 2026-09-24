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
    summary: '爺爺回信解鎖榨汁機、紅蘿蔔與梨；後半主線必須再解鎖靜謐噴泉。',
    unlockRequirement: {
      villageId: 'east-harbor',
      satisfactionRequired: 220,
      formalCustomersRequired: 17,
      action: '寄信給爺爺',
      timing: '隔天收信後解鎖榨汁機',
    },
    progressionNotes: [
      '階段四任務：讓德里克（領主）成為顧客。',
      '完成後支付 300 金幣，解鎖新地區「靜謐噴泉」。',
      '靜謐噴泉解鎖後才可寄下一封信給爺爺。',
    ],
  },
  {
    id: 5,
    label: '階段五',
    summary: '靜謐噴泉解鎖後寄下一封信；隔天回信解鎖果汁調和器。',
  },
  {
    id: 6,
    label: '階段六',
    summary: '東港村滿意度 525、靜謐噴泉滿意度 25 後寄信給爺爺；收到回信後解鎖高級悲劇清洗台。',
    unlockRequirement: {
      satisfactionByVillageRequired: {
        'east-harbor': 525,
        'tranquil-fountain': 25,
      },
      action: '寄信給爺爺',
      timing: '收到回信後解鎖；等待時間未確認',
    },
    progressionNotes: [
      '本次實測曾在一大早寄信後，約當日下午 15:00 收到回信。',
      '由於該任務曾延遲一天才完成，尚不能判定「當日下午回信」是否為固定規則。',
      '因此只確認「寄信後收到爺爺回信」是解鎖條件，不把同日或隔日寫成固定 timing。',
    ],
  },
]
