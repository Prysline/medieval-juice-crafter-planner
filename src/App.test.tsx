import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { customers } from './data/customers'
import { ComparisonDock } from './App'

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
