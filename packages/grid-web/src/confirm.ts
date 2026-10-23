/**
 * 两步确认：第一次点击把按钮切成「再点一次确认」，限定时间内再点才执行，超时自动复原。
 *
 * 嵌入模式不能用 window.confirm / alert / prompt：知帆宿主的 iframe 沙箱没有 allow-modals，
 * 浏览器会直接忽略弹窗并让 confirm 返回 false，按钮就成了「点了没反应」。
 */
export function armTwoStep(
  button: HTMLElement,
  onConfirm: () => void,
  options: { armedLabel: string; timeoutMs?: number },
): () => void {
  const idleLabel = button.textContent ?? '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const disarm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    button.textContent = idleLabel;
    button.classList.remove('armed');
  };

  const handler = () => {
    if (timer === undefined) {
      button.textContent = options.armedLabel;
      button.classList.add('armed');
      timer = setTimeout(disarm, options.timeoutMs ?? 4000);
      return;
    }
    disarm();
    onConfirm();
  };

  button.addEventListener('click', handler);
  return () => {
    disarm();
    button.removeEventListener('click', handler);
  };
}
