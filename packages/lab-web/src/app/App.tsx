import { CircuitWorkspace } from '@/workspace/CircuitWorkspace'

import styles from './App.module.css'

export function App() {
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span>J-Circuit v1.2 原型</span>
        <span className={styles.subtitle}>拖拽元件开始搭建电路</span>
      </header>
      <main className={styles.main}>
        <CircuitWorkspace />
      </main>
    </div>
  )
}
