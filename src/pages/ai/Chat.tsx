import { useState, useEffect } from 'react'
import { Typography, Card, Input, Button, List, Spin, Space } from 'antd'
import { SendOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons'
import MainLayout from '@components/layout/MainLayout'
import { streamChat, ChatMessage } from '@services/ai.api'

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: '你好！我是Simulink AI助手，随时为你解答建模与学习问题。' }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('chat_session')
      if (saved) {
        const arr = JSON.parse(saved)
        if (Array.isArray(arr) && arr.length) setMessages(arr)
      }
    } catch {}
  }, [])

  useEffect(() => {
    try { localStorage.setItem('chat_session', JSON.stringify(messages)) } catch {}
  }, [messages])

  const send = async () => {
    if (!input.trim()) return
    const userMsg: ChatMessage = { role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    let assistantContent = ''
    for await (const chunk of streamChat([...messages, userMsg])) {
      assistantContent += chunk.content
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last.role === 'assistant') {
          return [...prev.slice(0, -1), { ...last, content: assistantContent }]
        }
        return [...prev, { ...chunk, content: assistantContent }]
      })
    }
    setLoading(false)
  }

  return (
    <MainLayout>
      <Typography.Title level={3} className="flex items-center gap-2">
        <RobotOutlined className="text-purple-600" /> AI 助手
      </Typography.Title>
      <Card className="shadow-lg">
        <div className="h-96 overflow-y-auto pr-2">
          <List
            dataSource={messages}
            renderItem={(m, idx) => (
              <div key={idx} className={`flex mb-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-md px-4 py-2 rounded-xl ${m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {m.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                    <span className="text-sm font-semibold">{m.role === 'user' ? '我' : 'AI助手'}</span>
                  </div>
                  {renderMessageContent(m.content)}
                  {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                    <div className="mt-2 text-xs">
                      <span className="font-semibold">来源：</span>
                      {m.sources.map((s, i) => (
                        <a key={i} href={s.url} className="ml-2 underline" target="_blank" rel="noreferrer">{s.title}</a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          />
          {loading && (
            <div className="flex justify-start mb-3">
              <div className="bg-gray-100 text-gray-800 max-w-md px-4 py-2 rounded-xl flex items-center gap-2">
                <Spin size="small" />
                <span>思考中…</span>
              </div>
            </div>
          )}
        </div>
      </Card>
      <div className="mt-4 flex items-center gap-2">
        <Space.Compact style={{ width: '100%' }}>
          <Input.TextArea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="输入你的问题…"
            autoSize={{ minRows: 1, maxRows: 4 }}
            onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); send() } }}
          />
          <Button type="primary" icon={<SendOutlined />} onClick={send} loading={loading} />
        </Space.Compact>
        <Button onClick={() => { setMessages([{ role: 'assistant', content: '会话已清空，可以继续提问。' }]); try { localStorage.removeItem('chat_session') } catch {} }}>清空会话</Button>
      </div>
    </MainLayout>
  )
}
  const renderMessageContent = (text: string) => {
    const blocks: React.ReactNode[] = []
    const codeRegex = /```([\s\S]*?)```/g
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = codeRegex.exec(text))) {
      const plain = text.slice(cursor, match.index)
      if (plain) blocks.push(renderMarkdownInline(plain))
      blocks.push(<pre className="bg-gray-900 text-white p-2 rounded"><code>{match[1]}</code></pre>)
      cursor = codeRegex.lastIndex
    }
    const tail = text.slice(cursor)
    if (tail) blocks.push(renderMarkdownInline(tail))
    return <>{blocks}</>
  }

  const renderMarkdownInline = (text: string) => {
    const lines = text.split(/\r?\n/)
    const nodes: React.ReactNode[] = []
    for (const line of lines) {
      if (/^###\s+/.test(line)) nodes.push(<div className="font-semibold text-sm">{line.replace(/^###\s+/, '')}</div>)
      else if (/^##\s+/.test(line)) nodes.push(<div className="font-semibold">{line.replace(/^##\s+/, '')}</div>)
      else if (/^#\s+/.test(line)) nodes.push(<div className="font-bold text-lg">{line.replace(/^#\s+/, '')}</div>)
      else if (/^[-*]\s+/.test(line)) nodes.push(<div className="pl-4">• {line.replace(/^[-*]\s+/, '')}</div>)
      else nodes.push(replaceLinks(line))
    }
    return <>{nodes}</>
  }

  const replaceLinks = (text: string) => {
    const parts: React.ReactNode[] = []
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
    let idx = 0
    let m: RegExpExecArray | null
    while ((m = linkRegex.exec(text))) {
      const pre = text.slice(idx, m.index)
      if (pre) parts.push(pre)
      parts.push(<a href={m[2]} target="_blank" rel="noreferrer" className="underline text-blue-600">{m[1]}</a>)
      idx = linkRegex.lastIndex
    }
    const rest = text.slice(idx)
    if (rest) parts.push(rest)
    return <div className="whitespace-pre-wrap">{parts}</div>
  }
