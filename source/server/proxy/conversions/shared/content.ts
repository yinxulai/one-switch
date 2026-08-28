import { asArray, asObject, asString } from './json'

export function contentBlocksToText(content: unknown): string {
  if (typeof content === 'string') return content
  return asArray(content)
    .map(block => {
      const record = asObject(block)
      return record?.type === 'text' ? (asString(record.text) ?? '') : ''
    })
    .join('')
}
