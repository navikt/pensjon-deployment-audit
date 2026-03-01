import { describe, expect, it } from 'vitest'
import { requireParams, requireTeamEnvAppParams, requireTeamEnvParams } from '../route-params.server'

describe('route-params', () => {
  describe('requireParams', () => {
    it('returns values when all params present', () => {
      const result = requireParams({ a: '1', b: '2' }, ['a', 'b'])
      expect(result).toEqual({ a: '1', b: '2' })
    })

    it('throws 400 when a param is missing', () => {
      expect(() => requireParams({ a: '1' }, ['a', 'b'])).toThrow()
    })

    it('throws 400 when a param is undefined', () => {
      expect(() => requireParams({ a: '1', b: undefined as unknown as string }, ['a', 'b'])).toThrow()
    })
  })

  describe('requireTeamEnvParams', () => {
    it('returns team and env', () => {
      const result = requireTeamEnvParams({ team: 't1', env: 'dev' })
      expect(result).toEqual({ team: 't1', env: 'dev' })
    })

    it('throws when env missing', () => {
      expect(() => requireTeamEnvParams({ team: 't1' })).toThrow()
    })
  })

  describe('requireTeamEnvAppParams', () => {
    it('returns team, env and app', () => {
      const result = requireTeamEnvAppParams({
        team: 't1',
        env: 'dev',
        app: 'myapp',
      })
      expect(result).toEqual({ team: 't1', env: 'dev', app: 'myapp' })
    })

    it('throws when app missing', () => {
      expect(() => requireTeamEnvAppParams({ team: 't1', env: 'dev' })).toThrow()
    })
  })
})
