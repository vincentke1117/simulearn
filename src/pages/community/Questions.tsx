import { Typography, Card, List, Input, Button } from 'antd'
import { useState } from 'react'
import MainLayout from '@components/layout/MainLayout'

export default function Questions() {
  const saved = (() => { try { return JSON.parse(localStorage.getItem('community:questions')||'[]') as {id:string;title:string;content:string;answers?:{content:string}[]}[] } catch { return [] } })()
  const [items, setItems] = useState(saved)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const add = () => {
    if (!title.trim() || !content.trim()) return
    const next = [{ id: String(Date.now()), title, content, answers: [] }, ...items]
    setItems(next)
    try { localStorage.setItem('community:questions', JSON.stringify(next)) } catch {}
    setTitle('')
    setContent('')
  }
  return (
    <MainLayout>
      <Typography.Title level={3}>社区问答</Typography.Title>
      <Card className="mb-4">
        <Input placeholder="标题" value={title} onChange={e=>setTitle(e.target.value)} className="mb-2" />
        <Input.TextArea placeholder="内容" value={content} onChange={e=>setContent(e.target.value)} autoSize={{minRows:3,maxRows:6}} />
        <div className="mt-2"><Button type="primary" onClick={add}>发布提问</Button></div>
      </Card>
      <Card title="最新提问">
        <List
          dataSource={items}
          renderItem={(q, i) => (
            <List.Item>
              <div className="w-full">
                <Typography.Text strong>{q.title}</Typography.Text>
                <div className="text-sm text-gray-600 whitespace-pre-wrap">{q.content}</div>
                <div className="mt-2"><Button type="link" href={`/community/questions/${q.id}`}>查看详情</Button></div>
              </div>
            </List.Item>
          )}
        />
      </Card>
    </MainLayout>
  )
}
