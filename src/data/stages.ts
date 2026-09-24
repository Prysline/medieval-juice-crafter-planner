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
  {
    id: 7,
    label: '階段七',
    summary: '東港村顧客 29、靜謐噴泉顧客 15 後寄信給爺爺；收到回信後解鎖高級柑橘榨汁機。',
    unlockRequirement: {
      formalCustomersByVillageRequired: {
        'east-harbor': 29,
        'tranquil-fountain': 15,
      },
      action: '寄信給爺爺',
      timing: '收到回信後解鎖；約 6 小時規則待驗證',
    },
    progressionNotes: [
      '目前兩次主線信件觀察約為 08:4X 寄信 → 14:00 回信、09:XX 寄信 → 15:00 回信。',
      '兩次都接近寄信後 6 小時，因此「約 6 小時後回信」目前是強烈推測，但尚未升格為固定規則。',
      '玩家推測若寄信時間太晚，可能要等隔天才能取信；目前尚缺直接跨日邊界實測。',
    ],
  },
]
