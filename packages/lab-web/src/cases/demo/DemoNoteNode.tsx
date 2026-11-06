import type { Node, NodeProps } from '@xyflow/react'

import styles from './demo.module.css'

export type DemoNoteData = { text: string; tone?: 'info' | 'accent' | 'warn' }

const TONE: Record<string, string> = { info: styles.noteInfo, accent: styles.noteAccent, warn: styles.noteWarn }

/** 演示画布上的文字气泡：只在播放器里注册，不是电路元件，不发给内核 */
export function DemoNoteNode({ data }: NodeProps<Node<DemoNoteData>>) {
  return <div className={`${styles.note} ${TONE[data.tone ?? 'info']}`}>{data.text}</div>
}
