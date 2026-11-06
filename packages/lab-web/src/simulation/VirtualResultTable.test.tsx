import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VirtualResultTable } from './VirtualResultTable'

describe('VirtualResultTable', () => {
  it('微安级的支路电流带词头显示，不被固定小数截成 0.000001（例 4-8 检流计电流 1.434 μA）', () => {
    render(<VirtualResultTable entries={[['RG', 1.4343498e-6], ['R1', 0.008321]]} columns={['支路', '电流']} unit="A" />)
    expect(screen.getByText('1.43435 µA')).toBeInTheDocument()
    expect(screen.getByText('8.32100 mA')).toBeInTheDocument()
  })

  it('求解器的舍入残差当 0 显示（平衡电桥里检流计应当没有电流）', () => {
    render(<VirtualResultTable entries={[['RG', 3e-19]]} columns={['支路', '电流']} unit="A" />)
    expect(screen.getByText('0 A')).toBeInTheDocument()
  })
})
