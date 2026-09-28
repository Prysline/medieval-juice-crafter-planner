import { describe, expect, it } from 'vitest'
import { customers } from './customers'

describe('observed customer preferences', () => {
  it('records Octavius preferences from the direct screenshot', () => {
    const octavius = customers.find((customer) => customer.id === 'octavius')

    expect(octavius?.preferences).toEqual([
      { kind: 'ingredient', value: '肉桂' },
      { kind: 'effect', value: '改善視力' },
      { kind: 'effect', value: '煥亮肌膚' },
    ])
  })
  it('records Savius preferences from the direct screenshot', () => {
    const savius = customers.find((customer) => customer.id === 'savius')

    expect(savius?.preferences).toEqual([
      { kind: 'ingredient', value: '檸檬' },
      { kind: 'effect', value: '強健骨骼' },
      { kind: 'effect', value: '舒緩腸胃' },
    ])
  })

})
