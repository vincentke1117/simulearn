import { describe, expect, it } from 'vitest';

import { API_BASE, apiUrl } from './api';

// 页面在三种部署下的位置 → 相对地址必须解析到各自的接口前缀（知帆拓展约定 zhifan-ext/1 §3）
const resolve = (pageUrl: string, path: string) => new URL(apiUrl(path), pageUrl).pathname;

describe('apiUrl', () => {
  it('never starts with a slash', () => {
    expect(API_BASE.startsWith('/')).toBe(false);
    expect(apiUrl('pf').startsWith('/')).toBe(false);
  });

  it('resolves under the zhifan host prefix /ext/<id>/', () => {
    expect(resolve('http://127.0.0.1:51234/ext/simulearn-grid/ui/', 'pf')).toBe('/ext/simulearn-grid/api/grid/pf');
    expect(resolve('http://127.0.0.1:51234/ext/simulearn-grid/ui/index.html', 'examples/ieee33')).toBe(
      '/ext/simulearn-grid/api/grid/examples/ieee33',
    );
  });

  it('resolves under the extension process itself (/ui/)', () => {
    expect(resolve('http://127.0.0.1:50000/ui/', 'opf')).toBe('/api/grid/opf');
  });

  it('resolves under the dev gateway (/grid/) and the Vite dev server (/)', () => {
    expect(resolve('http://127.0.0.1:8100/grid/', 'n1')).toBe('/api/grid/n1');
    expect(resolve('http://127.0.0.1:5173/', 'pf')).toBe('/api/grid/pf');
  });
});
