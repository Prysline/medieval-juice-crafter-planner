import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

function ruleBody(selector, source = styles) {
  const escaped = selector.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}'))
  expect(match).not.toBeNull()
  return match?.[1] ?? ''
}

describe('sales trip layout CSS contract', () => {
  it('keeps the trip body vertical without rewriting the generic batch-card layout', () => {
    const bodyRule = ruleBody(
      '.optimizer-sales-trip-card > .optimizer-sales-trip-body',
    )

    expect(bodyRule).toContain('display: grid')
    expect(bodyRule).not.toContain('!important')
    expect(ruleBody('.optimizer-batch-card > div')).toContain('display: flex')
  })

  it('uses a responsive desktop jar grid and collapses it to one column on mobile', () => {
    const desktopJarRule = ruleBody('.optimizer-sales-jar-list')
    expect(desktopJarRule).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))',
    )

    const mobileStart = styles.lastIndexOf('@media (max-width: 720px)')
    expect(mobileStart).toBeGreaterThanOrEqual(0)
    const mobileStyles = styles.slice(mobileStart)
    expect(ruleBody('.optimizer-sales-jar-list', mobileStyles)).toContain(
      'grid-template-columns: 1fr',
    )
  })
})
