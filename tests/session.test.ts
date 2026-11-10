import { describe, expect, it } from 'vitest'
import { emptySession, isVisible, sanitizeSession } from '../src/shared/session'

describe('sanitizeSession', () => {
  it('starts maximized with nothing remembered', () => {
    expect(emptySession().window.maximized).toBe(true)
    expect(sanitizeSession(undefined)).toEqual(emptySession())
    expect(sanitizeSession('rubbish')).toEqual(emptySession())
  })

  it('keeps good values and drops bad ones', () => {
    const s = sanitizeSession({ window: { bounds: { x: 10, y: 20, width: 1200, height: 800 }, maximized: false }, dirs: { snapshot: '/a', recording: 5 }, snapshotPath: '/a/x.snap', state: { v: 1 } })
    expect(s.window).toEqual({ bounds: { x: 10, y: 20, width: 1200, height: 800 }, maximized: false })
    expect(s.dirs).toEqual({ snapshot: '/a', recording: '', audio: '' })
    expect(s.snapshotPath).toBe('/a/x.snap')
    expect(s.state).toEqual({ v: 1 })
  })

  it('ignores a window size that cannot be right', () => {
    expect(sanitizeSession({ window: { bounds: { x: 0, y: 0, width: 5, height: 5 } } }).window.bounds).toBeNull()
    expect(sanitizeSession({ window: { bounds: { x: 'a', y: 0, width: 800, height: 600 } } }).window.bounds).toBeNull()
  })
})

describe('isVisible', () => {
  const screen = { x: 0, y: 0, width: 1920, height: 1080 }
  it('accepts a window on a display', () => {
    expect(isVisible({ x: 100, y: 100, width: 1200, height: 800 }, [screen])).toBe(true)
  })
  it('rejects a window left on a display that is gone', () => {
    expect(isVisible({ x: 2500, y: 100, width: 1200, height: 800 }, [screen])).toBe(false)
  })
  it('accepts a window on a second display', () => {
    expect(isVisible({ x: 2000, y: 0, width: 1000, height: 700 }, [screen, { x: 1920, y: 0, width: 1920, height: 1080 }])).toBe(true)
  })
})
