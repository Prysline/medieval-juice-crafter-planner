import { describe, expect, it } from 'vitest'
import {
  ingredientIdsFromJuiceStateIdentity,
  isJuiceStateIdentity,
  juiceStateIdentity,
} from './juiceStateIdentity'

describe('juice-state identity', () => {
  it('uses ordered ingredient ids and stays distinct from final recipe identity', () => {
    expect(juiceStateIdentity(['lemon', 'sugar'])).toBe(
      'juice-state:v1:lemon/sugar',
    )
    expect(juiceStateIdentity(['sugar', 'lemon'])).toBe(
      'juice-state:v1:sugar/lemon',
    )
    expect(juiceStateIdentity(['lemon', 'sugar'])).not.toBe(
      'computed:lemon+sugar',
    )
  })

  it('round-trips ingredient ids without relying on unsafe delimiters', () => {
    const identity = juiceStateIdentity([
      'future/base',
      'plus+ingredient',
      '空 白',
    ])

    expect(ingredientIdsFromJuiceStateIdentity(identity)).toEqual([
      'future/base',
      'plus+ingredient',
      '空 白',
    ])
    expect(isJuiceStateIdentity(identity)).toBe(true)
  })

  it('rejects empty, malformed, and non-canonical identities', () => {
    expect(() => juiceStateIdentity([])).toThrow()
    expect(() => juiceStateIdentity([''])).toThrow()
    expect(ingredientIdsFromJuiceStateIdentity('computed:lemon')).toBeNull()
    expect(
      ingredientIdsFromJuiceStateIdentity('juice-state:v1:'),
    ).toBeNull()
    expect(
      ingredientIdsFromJuiceStateIdentity('juice-state:v1:%E0%A4%A'),
    ).toBeNull()
    expect(
      ingredientIdsFromJuiceStateIdentity('juice-state:v1:future%2fbase'),
    ).toBeNull()
  })
})
