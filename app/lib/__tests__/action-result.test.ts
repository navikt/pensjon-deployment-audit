import { describe, expect, test } from 'vitest'
import { type ActionResult, fail, ok } from '../action-result'

describe('action-result', () => {
  test('ok() returns success message', () => {
    const result = ok('Saved!')
    expect(result).toEqual({ success: 'Saved!' })
  })

  test('fail() returns error message', () => {
    const result = fail('Something went wrong')
    expect(result).toEqual({ error: 'Something went wrong' })
  })

  test('ActionResult type allows both fields', () => {
    const result: ActionResult = { success: 'ok', error: 'also ok' }
    expect(result.success).toBe('ok')
    expect(result.error).toBe('also ok')
  })

  test('ActionResult type allows empty object', () => {
    const result: ActionResult = {}
    expect(result.success).toBeUndefined()
    expect(result.error).toBeUndefined()
  })
})
