import { useEffect, useRef, useState, type MouseEvent } from 'react'

export interface FloatingPanelState {
  position: { x: number; y: number }
  size: { width: number; height: number }
  handleMouseDownDrag: (event: MouseEvent) => void
  handleMouseDownResize: (event: MouseEvent) => void
}

export function useFloatingPanel(
  initialPosition = { x: 100, y: 100 },
  initialSize = { width: 800, height: 600 },
): FloatingPanelState {
  const [position, setPosition] = useState(initialPosition)
  const [size, setSize] = useState(initialSize)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 })

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

        setPosition({
          x: Math.max(minX, Math.min(maxX, newX)),
          y: Math.max(minY, Math.min(maxY, newY)),
        })
      } else if (isResizing) {
        const deltaX = e.clientX - resizeStartRef.current.x
        const deltaY = e.clientY - resizeStartRef.current.y
        setSize({
          width: Math.max(400, resizeStartRef.current.width + deltaX),
          height: Math.max(300, resizeStartRef.current.height + deltaY),
        })
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
