import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTwoStep } from './useTwoStep'

describe('useTwoStep', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs only on the second click within the time limit', () => {
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useTwoStep(onConfirm, 1000))
    act(() => result.current.click())
    expect(result.current.armed).toBe(true)
    expect(onConfirm).not.toHaveBeenCalled()
    act(() => result.current.click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(result.current.armed).toBe(false)
  })

  it('disarms after the time limit, so a late second click only re-arms', () => {
    const onConfirm = vi.fn()
    const { result } = renderHook(() => useTwoStep(onConfirm, 1000))
    act(() => result.current.click())
    act(() => { vi.advanceTimersByTime(1001) })
    expect(result.current.armed).toBe(false)
    act(() => result.current.click())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(result.current.armed).toBe(true)
  })
})
