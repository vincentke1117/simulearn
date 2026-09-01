declare module 'plotly.js-basic-dist-min' {
  import type { Config, Data, Layout } from 'plotly.js'

  interface PlotlyBasic {
    react(root: HTMLElement, data: Data[], layout: Partial<Layout>, config: Partial<Config>): Promise<void>
    purge(root: HTMLElement): void
    Plots: {
      resize(root: HTMLElement): Promise<void>
    }
  }

  const Plotly: PlotlyBasic
  export default Plotly
}
