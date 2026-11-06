import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveEmbedTarget } from '@/embed/circuit'
import type { WorkspaceEmbed } from '@/workspace/CircuitWorkspace'
import { CaseGuide } from './CaseGuide'
import { CaseLibraryView } from './CaseLibraryView'
import { CASE_LIBRARIES, QIU_CASES, caseFingerprint } from './library'
import { caseStoragePrefix } from './meta'

// 画布本身由 embedUi / 工作区测试覆盖；这里只看案例库把什么交给了工作区
const workspaceProps = vi.hoisted(() => [] as WorkspaceEmbed[])
vi.mock('@/workspace/CircuitWorkspace', () => ({
  CircuitWorkspace: ({ embed }: { embed: WorkspaceEmbed }) => {
    workspaceProps.push(embed)
    return (
      <div data-testid="workspace">
        {embed.guide}
        <button onClick={embed.onBack}>案例列表</button>
      </div>
    )
  },
}))

const PREFIX = 'slp:lab:exp:ch-lab-1:'
const library = CASE_LIBRARIES['qiu-circuits']
const first = QIU_CASES[0]

beforeEach(() => {
  localStorage.clear()
  workspaceProps.length = 0
})
afterEach(() => localStorage.clear())

describe('案例库页', () => {
  it('课程包写 {"library": id} 时解析成案例库，未登记的名字报错', async () => {
    const load = { experiment: 'x', project: { library: 'qiu-circuits' }, task: null }
    await expect(resolveEmbedTarget(load)).resolves.toEqual({ kind: 'library', library })
    await expect(resolveEmbedTarget({ ...load, project: { library: 'nope' } })).rejects.toThrow('没有名为 nope 的案例库')
  })

  it('按章列出案例；点进去交给工作区的是该案例自己的存储前缀、预设和说明卡', () => {
    render(<CaseLibraryView library={library} experimentPrefix={PREFIX} />)
    expect(screen.getByText(`第 ${first.chapter} 章 ${first.chapterTitle}`)).toBeInTheDocument()
    fireEvent.click(screen.getByText(first.title))

    expect(screen.getByTestId('workspace')).toBeInTheDocument()
    const embed = workspaceProps[workspaceProps.length - 1]
    expect(embed.storagePrefix).toBe(caseStoragePrefix(PREFIX, first.id))
    expect(embed.preset?.settings.method).toBe(first.preset.method)
    expect(embed.preset?.theveninRefs).toEqual(first.preset.theveninPort)
    expect(screen.getByRole('complementary', { name: '案例说明' })).toHaveTextContent(first.title)
  })

  it('记住上次打开的案例：重新进入实验直接回到它；回到列表就不再记', () => {
    const { unmount } = render(<CaseLibraryView library={library} experimentPrefix={PREFIX} />)
    fireEvent.click(screen.getByText(first.title))
    unmount()

    const again = render(<CaseLibraryView library={library} experimentPrefix={PREFIX} />)
    expect(screen.getByTestId('workspace')).toBeInTheDocument()
    fireEvent.click(screen.getByText('案例列表'))
    expect(screen.queryByTestId('workspace')).toBeNull()
    again.unmount()

    render(<CaseLibraryView library={library} experimentPrefix={PREFIX} />)
    expect(screen.queryByTestId('workspace')).toBeNull()
  })

  it('有这一版电路的草稿才标「改过参数」；案例改版后指纹对不上的旧草稿不标（打开时也不会恢复）', () => {
    const key = `${caseStoragePrefix(PREFIX, first.id)}draft-v1`
    localStorage.setItem(key, JSON.stringify({ fingerprint: caseFingerprint(first), project: first.circuit }))
    const { unmount } = render(<CaseLibraryView library={library} experimentPrefix={PREFIX} />)
    expect(screen.getAllByText('改过参数')).toHaveLength(1)
    unmount()

    localStorage.setItem(key, JSON.stringify({ fingerprint: 'OLD', project: first.circuit }))
    render(<CaseLibraryView library={library} experimentPrefix={PREFIX} />)
    expect(screen.queryByText('改过参数')).toBeNull()
  })
})

describe('案例说明卡', () => {
  it('列出动手试试和教材结果，可以收起再展开', () => {
    render(<CaseGuide item={first} />)
    for (const text of first.tryIt) expect(screen.getByText(text)).toBeInTheDocument()
    for (const check of first.checks) expect(screen.getByText(check.label)).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('收起说明'))
    expect(screen.queryByText(first.summary)).toBeNull()
    fireEvent.click(screen.getByText('案例说明'))
    expect(screen.getByText(first.summary)).toBeInTheDocument()
  })
})
