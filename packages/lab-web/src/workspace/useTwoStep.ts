import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 两步确认：第一次点击进入「再点一次确认」，限定时间内再点才执行，超时自动复原。
 *
 * 嵌入模式不能用 window.confirm / alert / prompt：知帆宿主的 iframe 沙箱没有 allow-modals，
 * 浏览器会直接忽略弹窗并让 confirm 返回 false，按钮就成了「点了没反应」（与 grid-web/src/confirm.ts 同理）。
 */
export function useTwoStep(onConfirm: () => void, timeoutMs = 4000) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const disarm = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    setArmed(false)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  const click = useCallback(() => {
    if (timer.current === undefined) {
      setArmed(true)
      timer.current = setTimeout(disarm, timeoutMs)
      return
    }
    disarm()
    onConfirm()
  }, [disarm, onConfirm, timeoutMs])

  return { armed, click }
}
