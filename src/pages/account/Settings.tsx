import { Typography, Card, Switch, Space } from 'antd'
import MainLayout from '@components/layout/MainLayout'
import { useEffect, useState } from 'react'

export default function Settings() {
  const [autoSave, setAutoSave] = useState<boolean>(true)
  const [emailNotify, setEmailNotify] = useState<boolean>(false)
  useEffect(() => {
    const s = localStorage.getItem('settings')
    if (s) {
      try {
        const obj = JSON.parse(s)
        setAutoSave(!!obj.autoSave)
        setEmailNotify(!!obj.emailNotify)
      } catch {}
    }
  }, [])
  useEffect(() => {
    localStorage.setItem('settings', JSON.stringify({ autoSave, emailNotify }))
  }, [autoSave, emailNotify])
  
  return (
    <MainLayout>
      <Typography.Title level={3}>设置</Typography.Title>
      <Card>
        <Space direction="vertical" size="large">
          <div className="flex items-center justify-between">
            <Typography.Text>自动保存</Typography.Text>
            <Switch checked={autoSave} onChange={setAutoSave} />
          </div>
          <div className="flex items-center justify-between">
            <Typography.Text>邮件通知</Typography.Text>
            <Switch checked={emailNotify} onChange={setEmailNotify} />
          </div>
        </Space>
      </Card>
    </MainLayout>
  )
}
