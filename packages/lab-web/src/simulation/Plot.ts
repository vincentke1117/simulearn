import { createElement, useEffect, useRef, type CSSProperties } from 'react'
import type { Config, Data, Layout } from 'plotly.js'
import Plotly from 'plotly.js-basic-dist-min'

export interface PlotProps {
  data: Data[]
  layout?: Partial<Layout>
  config?: Partial<Config>
  useResizeHandler?: boolean
  className?: string
  style?: CSSProperties
}

export function Plot({ data, layout = {}, config = {}, useResizeHandler = false, className, style }: PlotProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    void Plotly.react(root, data, layout, config)
    return () => Plotly.purge(root)
  }, [config, data, layout])

  useEffect(() => {
    const root = rootRef.current
    if (!root || !useResizeHandler) return

    const observer = new ResizeObserver(() => {
      void Plotly.Plots.resize(root)
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [useResizeHandler])

  return createElement('div', { ref: rootRef, className, style })
}
