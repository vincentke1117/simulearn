import { useEffect, useRef, useState, type MouseEvent } from 'react'

export interface FloatingPanelState {
  position: { x: number; y: number }
  size: { width: number; height: number }
  handleMouseDownDrag: (event: MouseEvent) => void
  handleMouseDownResize: (event: MouseEvent) => void
}

type Box = { position: { x: number; y: number }; size: { width: number; height: number } }

const VIEWPORT_MARGIN = 16

/**
 * 把面板收进视口：尺寸不超过视口减边距，位置保证整块面板（含右下角的缩放手柄）都看得见。
 * 嵌入知帆课堂时舞台大小不固定（约定 §4），默认 800×600 放在 (100, 100) 会让底部落到 iframe 外面。
 */
export function fitPanelToViewport(box: Box, viewport: { width: number; height: number }): Box {
  const width = Math.min(box.size.width, Math.max(viewport.width - 2 * VIEWPORT_MARGIN, 0))
  const height = Math.min(box.size.height, Math.max(viewport.height - 2 * VIEWPORT_MARGIN, 0))
  const x = Math.min(Math.max(box.position.x, VIEWPORT_MARGIN), Math.max(viewport.width - width - VIEWPORT_MARGIN, VIEWPORT_MARGIN))
  const y = Math.min(Math.max(box.position.y, VIEWPORT_MARGIN), Math.max(viewport.height - height - VIEWPORT_MARGIN, VIEWPORT_MARGIN))
  return { position: { x, y }, size: { width, height } }
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })

export function useFloatingPanel(
  initialPosition = { x: 100, y: 100 },
  initialSize = { width: 800, height: 600 },
): FloatingPanelState {
  const [box, setBox] = useState<Box>(() => fitPanelToViewport({ position: initialPosition, size: initialSize }, viewport()))
  const { position, size } = box
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 })

  // 窗口（嵌入时是课堂舞台）变小时重新收一次，免得面板被裁掉、缩放手柄够不着
  useEffect(() => {
    const onResize = () => setBox((current) => fitPanelToViewport(current, viewport()))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const handleMouseDownDrag = (e: MouseEvent) => {
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    }
    e.preventDefault()
  }

  const handleMouseDownResize = (e: MouseEvent) => {
    setIsResizing(true)
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    }
    e.preventDefault()
    e.stopPropagation()
  }

  useEffect(() => {
    const handleMouseMove = (e: globalThis.MouseEvent) => {
      if (isDragging) {
        const minY = -10
        const maxY = window.innerHeight - 40
        const minX = -size.width + 100
        const maxX = window.innerWidth - 100

        const newX = e.clientX - dragStartRef.current.x
        const newY = e.clientY - dragStartRef.current.y

        setBox((current) => ({
          ...current,
          position: {
            x: Math.max(minX, Math.min(maxX, newX)),
            y: Math.max(minY, Math.min(maxY, newY)),
          },
        }))
      } else if (isResizing) {
        const deltaX = e.clientX - resizeStartRef.current.x
        const deltaY = e.clientY - resizeStartRef.current.y
        // 下限 400×300，但不能把面板撑出视口：舞台很小时手柄会被推到 iframe 外，再也缩不回来
        setBox((current) => ({
          ...current,
          size: {
            width: Math.min(Math.max(400, resizeStartRef.current.width + deltaX), Math.max(window.innerWidth - current.position.x - VIEWPORT_MARGIN, 0)),
            height: Math.min(Math.max(300, resizeStartRef.current.height + deltaY), Math.max(window.innerHeight - current.position.y - VIEWPORT_MARGIN, 0)),
          },
        }))
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      setIsResizing(false)
    }

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, isResizing, size.width])

  return { position, size, handleMouseDownDrag, handleMouseDownResize }
}
