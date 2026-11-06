import { createElement, useEffect, useRef, type CSSProperties } from 'react'
import type { Config, Data, Layout } from 'plotly.js'
import Plotly from 'plotly.js-basic-dist-min'

import { simulationApiOptions } from './apiBase'

/**
 * 嵌入知帆课堂时去掉工具条的「下载为 PNG」：宿主 iframe 沙箱不许下载（约定 §3），按钮会点了没反应。
 */
export function plotConfigFor(config: Partial<Config>, embedded: boolean): Partial<Config> {
  if (!embedded) return config
  return { ...config, modeBarButtonsToRemove: [...(config.modeBarButtonsToRemove ?? []), 'toImage'] }
}

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

    void Plotly.react(root, data, layout, plotConfigFor(config, simulationApiOptions().embedded))
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
