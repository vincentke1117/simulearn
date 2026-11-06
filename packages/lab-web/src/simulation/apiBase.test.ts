import { describe, expect, it } from 'vitest'

import { API_BASE_URL } from './apiBase'

// 同一份构建产物要在三种地方都打到内核：知帆宿主的 /ext/<id>/ui/、开发态网关的 /circuit/、Vite 开发服务器的根路径。
// 写成以 / 开头的绝对地址会绕过宿主的 /ext/<id>/ 前缀（约定 §3）。
describe('API_BASE_URL', () => {
  it('is relative to the page', () => {
    expect(API_BASE_URL.startsWith('/')).toBe(false)
    expect(API_BASE_URL).not.toMatch(/^[a-z]+:/i)
  })

  it.each([
    ['http://127.0.0.1:51234/ext/simulearn-lab/ui/', '/ext/simulearn-lab/api/lab/simulate'],
    ['http://127.0.0.1:51234/ext/simulearn-lab/ui/index.html', '/ext/simulearn-lab/api/lab/simulate'],
    ['http://127.0.0.1:51234/ui/', '/api/lab/simulate'],
    ['http://127.0.0.1:8100/circuit/', '/api/lab/simulate'],
    ['http://localhost:3000/', '/api/lab/simulate'],
  ])('from %s reaches %s', (page, expected) => {
    expect(new URL(`${API_BASE_URL}/simulate`, page).pathname).toBe(expected)
  })
})
