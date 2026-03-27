import { useRef, type ChangeEvent } from 'react'

import styles from './ProjectToolbar.module.css'

export interface ProjectToolbarProps {
  onExport: () => void
  onImport: (content: string) => Promise<void> | void
  onImportError?: (message: string) => void
  canExport: boolean
  onReset?: () => void  // 新增：重置电路
}

export function ProjectToolbar({ onExport, onImport, onImportError, canExport, onReset }: ProjectToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = async () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      try {
        await onImport(text)
      } catch (error) {
        onImportError?.(
          error instanceof Error ? error.message : '导入失败，文件内容不符合要求',
        )
      } finally {
        event.target.value = ''
      }
    }
    reader.onerror = () => {
      onImportError?.('读取文件失败')
      event.target.value = ''
    }
    reader.readAsText(file)
  }

  return (
    <div className={styles.toolbar}>
      <button type="button" className={styles.button} onClick={handleImportClick}>
        导入项目
      </button>
      <button type="button" className={styles.button} onClick={onExport} disabled={!canExport}>
        导出项目
      </button>
      {onReset && (
        <button type="button" className={styles.button} onClick={onReset}>
          重置电路
        </button>
      )}
      <input
        ref={fileInputRef}
        className={styles.input}
        type="file"
        accept="application/json"
        onChange={handleFileChange}
      />
    </div>
  )
}
