import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { customers } from './data/customers'
import {
  ComparisonDock,
  CustomerVillageFilterOptions,
  FormalCustomerStats,
  FullMatchAvailabilityNotice,
  FullMatchRecipeItem,
  NextProgressGoal,
  RecommendationDetails,
  SatisfactionFields,
  withSatisfactionUpdate,
} from './App'
import { villages } from './data/villages'
import type { RecipeCandidate } from './types'

describe('shared customer comparison dock', () => {
  it('keeps multiple selected customers visible outside the recipe tools tab', () => {
    const nanette = customers.find((customer) => customer.id === 'nanette')
    const jack = customers.find((customer) => customer.id === 'jack')
    expect(nanette).toBeDefined()
    expect(jack).toBeDefined()

    const html = renderToStaticMarkup(
      <ComparisonDock
        customers={[nanette!, jack!]}
        onOpenTools={() => {}}
        onRemove={() => {}}
        onClear={() => {}}
      />,
    )

    expect(html).toContain('比較顧客 2 人')
    expect(html).toContain('娜內特（魚販） ×')
    expect(html).toContain('傑克（帽匠） ×')
    expect(html).toContain('前往配方工具比較')
    expect(html).toContain('全部清除')
  })
})

describe('data-driven customer village filter options', () => {
  it('includes every canonical village unlocked at the current progress', () => {
    const beforeIbex = renderToStaticMarkup(
      <select>
        <CustomerVillageFilterOptions
          villageDefinitions={villages}
          currentProgress="advanced-citrus-juicer-unlocked"
        />
      </select>,
    )
    const atIbex = renderToStaticMarkup(
      <select>
        <CustomerVillageFilterOptions
          villageDefinitions={villages}
          currentProgress="ibex-statue-unlocked"
        />
      </select>,
    )

    expect(beforeIbex).toContain('東港村')
    expect(beforeIbex).toContain('靜謐噴泉')
    expect(beforeIbex).not.toContain('羱羊雕像')
    expect(atIbex).toContain('<option value="ibex-statue">羱羊雕像</option>')
  })

  it('renders an arbitrary future canonical village without another hardcoded option', () => {
    const villageDefinitions = [
      { id: 'starter', name: '起始地區', unlockedAt: 'opening' },
      {
        id: 'future-region',
        name: '未來地區',
        unlockedAt: 'juice-blender-unlocked',
      },
    ] as const

    const html = renderToStaticMarkup(
      <select>
        <CustomerVillageFilterOptions
          villageDefinitions={villageDefinitions}
          currentProgress="juice-blender-unlocked"
        />
      </select>,
    )

    expect(html).toContain('<option value="future-region">未來地區</option>')
  })
})


describe('data-driven satisfaction fields', () => {
  const villageDefinitions = [
    {
      id: 'east-harbor',
      name: '東港村',
      unlockedAt: 'opening',
    },
    {
      id: 'future-region',
      name: '未來地區',
      unlockedAt: 'juice-blender-unlocked',
    },
  ] as const

  const satisfactionByVillage = {
    'east-harbor': 12,
    'future-region': 34,
  }

  it('renders every unlocked definition without hardcoded village ids', () => {
    const openingHtml = renderToStaticMarkup(
      <SatisfactionFields
        villageDefinitions={villageDefinitions}
        currentProgress="opening"
        satisfactionByVillage={satisfactionByVillage}
        onSatisfactionChange={() => {}}
      />,
    )

    expect(openingHtml).toContain('東港村顧客滿意度')
    expect(openingHtml).not.toContain('未來地區顧客滿意度')

    const laterHtml = renderToStaticMarkup(
      <SatisfactionFields
        villageDefinitions={villageDefinitions}
        currentProgress="juice-blender-unlocked"
        satisfactionByVillage={satisfactionByVillage}
        onSatisfactionChange={() => {}}
      />,
    )

    expect(laterHtml).toContain('東港村顧客滿意度')
    expect(laterHtml).toContain('未來地區顧客滿意度')
    expect(laterHtml).toContain('value="34"')
  })

  it('updates an arbitrary canonical id with the existing normalization semantics', () => {
    expect(
      withSatisfactionUpdate(
        satisfactionByVillage,
        'future-region',
        78.9,
      ),
    ).toEqual({
      'east-harbor': 12,
      'future-region': 78,
    })
  })
})


describe('next progress goal presentation', () => {
  it('shows the next confirmed numeric thresholds from canonical progression data', () => {
    const formalCustomerIds = customers
      .filter((customer) => customer.villageId === 'east-harbor')
      .slice(0, 10)
      .map((customer) => customer.id)

    const html = renderToStaticMarkup(
      <NextProgressGoal
        currentProgress="seasoner-unlocked"
        satisfactionByVillage={{
          'east-harbor': 100,
          'tranquil-fountain': 0,
          'ibex-statue': 0,
        }}
        customerDefinitions={customers}
        formalCustomerIds={formalCustomerIds}
      />,
    )

    expect(html).toContain('下一個主線目標')
    expect(html).toContain('階段三｜果汁罐已解鎖')
    expect(html).toContain('東港村滿意度 100/120 · 尚差 20')
    expect(html).toContain('東港村正式顧客 10/14 人 · 尚差 4')
  })

  it('marks a Region milestone without inventing a numeric threshold', () => {
    const html = renderToStaticMarkup(
      <NextProgressGoal
        currentProgress="juicer-unlocked"
        satisfactionByVillage={{
          'east-harbor': 999,
          'tranquil-fountain': 999,
          'ibex-statue': 999,
        }}
        customerDefinitions={customers}
        formalCustomerIds={customers.map((customer) => customer.id)}
      />,
    )

    expect(html).toContain('下一個 Region 目標 · 靜謐噴泉')
    expect(html).toContain('階段四｜靜謐噴泉已解鎖')
    expect(html).toContain('目前沒有已確認的數值門檻')
  })
})

describe('data-driven formal customer summaries', () => {
  it('derives the next formal-customer threshold from canonical progression data', () => {
    const formalCustomerIds = customers
      .filter((customer) => customer.villageId === 'east-harbor')
      .slice(0, 10)
      .map((customer) => customer.id)

    const stage3Html = renderToStaticMarkup(
      <FormalCustomerStats
        villageDefinitions={villages}
        currentProgress="seasoner-unlocked"
        customerDefinitions={customers}
        formalCustomerIds={formalCustomerIds}
      />,
    )
    const stage4Html = renderToStaticMarkup(
      <FormalCustomerStats
        villageDefinitions={villages}
        currentProgress="juice-jar-unlocked"
        customerDefinitions={customers}
        formalCustomerIds={formalCustomerIds}
      />,
    )

    expect(stage3Html).toContain('階段三｜果汁罐已解鎖 10/14')
    expect(stage4Html).toContain('階段四｜榨汁機已解鎖 10/17')
  })

  it('shows a formal-customer card only after its region is unlocked', () => {
    const beforeIbex = renderToStaticMarkup(
      <FormalCustomerStats
        villageDefinitions={villages}
        currentProgress="advanced-citrus-juicer-unlocked"
        customerDefinitions={customers}
        formalCustomerIds={[]}
      />,
    )

    expect(beforeIbex).not.toContain('羱羊雕像正式顧客')

    const atIbex = renderToStaticMarkup(
      <FormalCustomerStats
        villageDefinitions={villages}
        currentProgress="ibex-statue-unlocked"
        customerDefinitions={customers}
        formalCustomerIds={[]}
      />,
    )

    expect(atIbex).toContain(
      '<span>羱羊雕像正式顧客</span><strong>0 人</strong>',
    )
  })

  it('counts formal customers for an arbitrary unlocked region definition', () => {
    const villageDefinitions = [
      { id: 'starter', name: '起始地區', unlockedAt: 'opening' },
      {
        id: 'future-region',
        name: '未來地區',
        unlockedAt: 'juice-blender-unlocked',
      },
    ] as const
    const customerDefinitions = [
      { id: 'starter-customer', villageId: 'starter' },
      { id: 'future-a', villageId: 'future-region' },
      { id: 'future-b', villageId: 'future-region' },
    ] as const

    const html = renderToStaticMarkup(
      <FormalCustomerStats
        villageDefinitions={villageDefinitions}
        currentProgress="juice-blender-unlocked"
        customerDefinitions={customerDefinitions}
        formalCustomerIds={['starter-customer', 'future-b']}
      />,
    )

    expect(html).toContain('起始地區正式顧客')
    expect(html).toContain(
      '<span>未來地區正式顧客</span><strong>1 人</strong>',
    )
  })
})


describe('customer recommendation readability', () => {
  const recipe: RecipeCandidate = {
    id: 'readable-recipe',
    name: '甜味（檸檬 → 糖）',
    source: 'observed',
    unlockedAt: 'seasoner-unlocked',
    salePrice: 19,
    ingredients: ['檸檬', '糖'],
    effects: [{ name: '甜味', value: 5 }],
    equipment: ['柑橘榨汁機', '調味器', '果汁成品台'],
  }

  it('shows full sequence, equipment, cost, authority, and save action for a full-match item', () => {
    const html = renderToStaticMarkup(
      <ol>
        <FullMatchRecipeItem
          recipe={recipe}
          saved={false}
          onSaveRecipe={() => {}}
        />
      </ol>,
    )

    expect(html).toContain('檸檬▸糖')
    expect(html).toContain('柑橘榨汁機・調味器・果汁成品台')
    expect(html).toContain('16 金幣／批 · 8 金幣／杯')
    expect(html).toContain('來源／可信狀態：正式實測')
    expect(html).toContain('加入我的配方')
  })

  it('renders one recommendation recipe with multiple reason tags instead of duplicating it', () => {
    const costed = {
      candidate: recipe,
      batchIngredientCost: 16,
      unitIngredientCost: 8,
    }
    const html = renderToStaticMarkup(
      <RecommendationDetails
        formal
        costMode="minimum"
        recommendations={{
          observedOnly: {
            policy: 'observed-only',
            costMode: 'minimum',
            batchIngredientCost: 16,
            unitIngredientCost: 8,
            candidates: [costed],
          },
          allowComputed: {
            policy: 'allow-unambiguous-computed',
            costMode: 'minimum',
            batchIngredientCost: 16,
            unitIngredientCost: 8,
            candidates: [costed],
          },
        }}
        savedRecipeCandidateIds={new Set()}
        onSaveRecipe={() => {}}
      />,
    )

    expect((html.match(/甜味（檸檬▸糖）/g) ?? [])).toHaveLength(1)
    expect(html).toContain('已實測最低成本')
    expect(html).toContain('目前可製作最低成本')
    expect(html).toContain('不會升格為專案 observed data')
  })

  it('explains future-only, ambiguous-only, and bounded-search misses without claiming global absence', () => {
    const futureHtml = renderToStaticMarkup(
      <FullMatchAvailabilityNotice
        availability={{
          kind: 'future-observed',
          currentSources: [],
          futureObservedMatches: [{
            id: 'future',
            name: '未來配方',
            unlockedAt: 'juice-blender-unlocked',
            salePrice: 50,
            ingredients: ['檸檬', '糖'],
            effects: [{ name: '甜味', value: 5 }],
            equipment: ['果汁調和器'],
          }],
          ambiguousCandidates: [],
          searchTruncated: false,
        }}
      />,
    )
    expect(futureHtml).toContain('後續進度才可製作')
    expect(futureHtml).toContain('已知後續實測 full match：未來配方')

    const ambiguousHtml = renderToStaticMarkup(
      <FullMatchAvailabilityNotice
        availability={{
          kind: 'ambiguous-only',
          currentSources: [],
          futureObservedMatches: [],
          ambiguousCandidates: [{
            ...recipe,
            id: 'ambiguous',
            source: 'computed',
            salePrice: null,
            effectAmbiguity: {
              cutoffValue: 5,
              remainingSlots: 1,
              candidates: [{ name: '甜味', value: 5 }],
            },
          }],
          searchTruncated: false,
        }}
      />,
    )
    expect(ambiguousHtml).toContain('目前只有歧義候選')
    expect(ambiguousHtml).toContain('不宣稱 full match')

    const noneHtml = renderToStaticMarkup(
      <FullMatchAvailabilityNotice
        availability={{
          kind: 'none-in-search-scope',
          currentSources: [],
          futureObservedMatches: [],
          ambiguousCandidates: [],
          searchTruncated: true,
        }}
      />,
    )
    expect(noneHtml).toContain('目前搜尋範圍沒有安全 full match')
    expect(noneHtml).toContain('不是「遊戲中不存在」的證明')
  })
})
