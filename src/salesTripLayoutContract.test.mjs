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
    expect(bodyRule).toContain('justify-content: stretch')
    expect(bodyRule).toContain('align-items: stretch')
    expect(bodyRule).not.toContain('!important')
    expect(ruleBody('.optimizer-batch-card > div')).toContain('display: flex')
  })

  it('uses a responsive desktop jar grid and collapses it to one column on mobile', () => {
    const desktopJarRule = ruleBody('.optimizer-sales-jar-list')
    expect(desktopJarRule).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))',
    )
    expect(desktopJarRule).toContain('align-items: start')

    const jarManifestRule = ruleBody('.optimizer-sales-jar-manifest')
    expect(jarManifestRule).toContain('align-content: start')
    expect(jarManifestRule).not.toContain('min-height')
    expect(jarManifestRule).not.toContain('height:')

    const mobileStart = styles.lastIndexOf('@media (max-width: 720px)')
    expect(mobileStart).toBeGreaterThanOrEqual(0)
    const mobileStyles = styles.slice(mobileStart)
    expect(ruleBody('.optimizer-sales-jar-list', mobileStyles)).toContain(
      'grid-template-columns: 1fr',
    )
  })

  it('uses a responsive custom-trip workspace without changing generic batch-card layout', () => {
    const desktopTripRule = ruleBody('.optimizer-custom-trip-grid')
    expect(desktopTripRule).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))',
    )
    expect(desktopTripRule).toContain('align-items: start')

    const tripCardRule = ruleBody('.optimizer-custom-trip-card')
    expect(tripCardRule).toContain('min-width: 0')
    expect(tripCardRule).toContain('align-content: start')
    expect(tripCardRule).toContain('border-width: 2px')
    expect(ruleBody('.optimizer-custom-region-group')).toContain(
      'border-left: 3px solid',
    )
    expect(ruleBody('.optimizer-batch-card')).not.toContain(
      'grid-template-columns',
    )

    const mobileStart = styles.lastIndexOf('@media (max-width: 720px)')
    expect(mobileStart).toBeGreaterThanOrEqual(0)
    const mobileStyles = styles.slice(mobileStart)
    expect(ruleBody('.optimizer-custom-trip-grid', mobileStyles)).toContain(
      'grid-template-columns: 1fr',
    )
  })
})
