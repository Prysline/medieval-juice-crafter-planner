import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { customers } from './data/customers'
import {
  ComparisonDock,
  FormalCustomerStats,
  SatisfactionFields,
  withSatisfactionUpdate,
} from './App'
import { villages } from './data/villages'

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


describe('data-driven formal customer summaries', () => {
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
