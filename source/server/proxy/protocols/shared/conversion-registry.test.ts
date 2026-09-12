import { describe, expect, it } from 'vitest'
import type { Protocol } from '@common/schemas'
import { CONVERTIBLE_PROTOCOLS, isConvertible } from '@common/protocols'
import { findRequestDirection, findResponseDirection, listConversionDirections } from './conversion-registry'

const ALL_PROTOCOLS = Object.keys(CONVERTIBLE_PROTOCOLS) as Protocol[]

function convertiblePairs(): string[] {
  const pairs: string[] = []
  for (const endpoint of ALL_PROTOCOLS) {
    for (const client of CONVERTIBLE_PROTOCOLS[endpoint]) pairs.push(`${client}->${endpoint}`)
  }
  return pairs.sort()
}

describe('conversion registry', () => {
  // 两张表漂移过一次，所以把「能力矩阵声明了什么」与「转换方向注册了什么」绑成断言。
  it('declares exactly the directions the convertible matrix allows', () => {
    const declared = listConversionDirections().map(direction => `${direction.from}->${direction.to}`).sort()
    expect(declared).toEqual(convertiblePairs())
  })

  it('resolves a request direction for every declared pair', () => {
    for (const endpoint of ALL_PROTOCOLS) {
      for (const client of CONVERTIBLE_PROTOCOLS[endpoint]) {
        expect(findRequestDirection(client, endpoint), `${client}->${endpoint}`).toBeDefined()
      }
    }
  })

  it('resolves a response direction for every declared pair', () => {
    for (const endpoint of ALL_PROTOCOLS) {
      for (const client of CONVERTIBLE_PROTOCOLS[endpoint]) {
        expect(findResponseDirection(endpoint, client), `${client}->${endpoint}`).toBeDefined()
      }
    }
  })

  it('does not resolve same-protocol or unknown directions', () => {
    for (const protocol of ALL_PROTOCOLS) {
      expect(isConvertible(protocol, protocol)).toBe(false)
      expect(findRequestDirection(protocol, protocol)).toBeUndefined()
      expect(findResponseDirection(protocol, protocol)).toBeUndefined()
    }
    expect(findRequestDirection('openai-responses', 'anthropic-messages')).toBeUndefined()
    expect(findResponseDirection('anthropic-messages', 'openai-responses')).toBeUndefined()
  })
})
