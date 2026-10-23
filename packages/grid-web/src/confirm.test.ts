// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { armTwoStep } from './confirm';

describe('armTwoStep (嵌入模式不能弹窗)', () => {
  let button: HTMLButtonElement;

  beforeEach(() => {
    vi.useFakeTimers();
    button = document.createElement('button');
    button.textContent = '恢复初始算例';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms on the first click without acting', () => {
    const onConfirm = vi.fn();
    armTwoStep(button, onConfirm, { armedLabel: '再点一次确认' });
    button.click();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button.textContent).toBe('再点一次确认');
    expect(button.classList.contains('armed')).toBe(true);
  });

  it('acts on the second click within the window and resets the label', () => {
    const onConfirm = vi.fn();
    armTwoStep(button, onConfirm, { armedLabel: '再点一次确认', timeoutMs: 4000 });
    button.click();
    vi.advanceTimersByTime(3000);
    button.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('恢复初始算例');
    expect(button.classList.contains('armed')).toBe(false);
  });

  it('disarms after the timeout so a later click only arms again', () => {
    const onConfirm = vi.fn();
    armTwoStep(button, onConfirm, { armedLabel: '再点一次确认', timeoutMs: 4000 });
    button.click();
    vi.advanceTimersByTime(4001);
    expect(button.textContent).toBe('恢复初始算例');
    button.click();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button.textContent).toBe('再点一次确认');
  });

  it('never calls window.confirm', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    armTwoStep(button, vi.fn(), { armedLabel: '再点一次确认' });
    button.click();
    button.click();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
