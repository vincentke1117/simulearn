import { Typography, Card, Input, Button, List } from 'antd'
import MainLayout from '@components/layout/MainLayout'
import { useParams } from 'react-router-dom'
import { useState, useMemo } from 'react'

export default function QuestionDetail() {
  const { qid } = useParams()
  const saved = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('community:questions')||'[]') as {id:string;title:string;content:string;answers?:{content:string}[]}[] } catch { return [] }
  }, [])
  const idx = saved.findIndex(q => q.id === qid)
  const q = idx >= 0 ? saved[idx] : null
  const [answer, setAnswer] = useState('')
  const addAnswer = () => {
    if (!q || !answer.trim()) return
    const next = [...saved]
    const ans = { content: answer }
    next[idx] = { ...q, answers: [...(q.answers||[]), ans] }
    try { localStorage.setItem('community:questions', JSON.stringify(next)) } catch {}
    setAnswer('')
  }
  return (
    <MainLayout>
      {!q ? (
        <Card>问题不存在或已删除</Card>
      ) : (
        <>
          <Typography.Title level={3}>问题详情</Typography.Title>
          <Card className="mb-4">
            <Typography.Text strong>{q.title}</Typography.Text>
            <div className="text-sm text-gray-600 whitespace-pre-wrap mt-2">{q.content}</div>
          </Card>
          <Card title="回答">
            <List
              dataSource={q.answers||[]}
              renderItem={(a, i) => (
                <List.Item>
                  <div className="whitespace-pre-wrap">{a.content}</div>
                </List.Item>
              )}
            />
            <div className="mt-3">
              <Input.TextArea value={answer} onChange={e=>setAnswer(e.target.value)} autoSize={{minRows:3,maxRows:6}} />
              <div className="mt-2"><Button type="primary" onClick={addAnswer}>提交回答</Button></div>
            </div>
          </Card>
        </>
      )}
    </MainLayout>
  )
}
