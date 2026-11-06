import { useEffect, useRef } from 'react'

/**
 * 翻页键：← → 之外，翻页笔多半发 PageUp / PageDown，空格也当「下一步」，Esc 退出。
 * 焦点在输入框、按着修饰键、或别人已经处理过的按键一律不管。
 */
export function useStepKeys({ onPrev, onNext, onClose }: { onPrev: () => void; onNext: () => void; onClose: () => void }) {
  const handlers = useRef({ onPrev, onNext, onClose })
  handlers.current = { onPrev, onNext, onClose }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (['ArrowRight', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault()
        handlers.current.onNext()
      } else if (['ArrowLeft', 'PageUp'].includes(event.key)) {
        event.preventDefault()
        handlers.current.onPrev()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        handlers.current.onClose()
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}
