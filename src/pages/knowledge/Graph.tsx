import { useState, useMemo } from 'react'
import { Typography, Card, Row, Col, Input, Segmented, List, Tag, Button } from 'antd'
import MainLayout from '@components/layout/MainLayout'
import { useNavigate } from 'react-router-dom'

type Node = { id: string; label: string; category: string }
type Edge = { from: string; to: string; relation: string }

export default function KnowledgeGraph() {
  const nav = useNavigate()
  const [category, setCategory] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Node | null>(null)

  const nodes: Node[] = [
    { id: 'n1', label: '控制系统', category: '控制系统' },
    { id: 'n2', label: 'PID控制器', category: '控制系统' },
    { id: 'n3', label: '传感器与噪声', category: '控制系统' },
    { id: 'n4', label: '5G通信系统', category: '通信' },
    { id: 'n5', label: '链路级仿真', category: '通信' },
    { id: 'n6', label: '新能源汽车BMS', category: '新能源汽车' }
  ]
  const edges: Edge[] = [
    { from: 'n2', to: 'n1', relation: '属于' },
    { from: 'n3', to: 'n1', relation: '相关' },
    { from: 'n6', to: 'n3', relation: '依赖' },
    { from: 'n5', to: 'n4', relation: '实现' },
    { from: 'n4', to: 'n1', relation: '跨域关联' }
  ]

  const filtered = useMemo(() => {
    return nodes.filter(n => (category === 'all' || n.category === category) && (n.label.includes(search)))
  }, [category, search])

  const neighbors = useMemo(() => {
    if (!selected) return []
    const set: string[] = []
    edges.forEach(e => {
      if (e.from === selected.id) set.push(e.to)
      if (e.to === selected.id) set.push(e.from)
    })
    return nodes.filter(n => set.includes(n.id))
  }, [selected])

  return (
    <MainLayout>
      <Typography.Title level={3}>知识图谱导航</Typography.Title>
      <Row gutter={[24,24]}>
        <Col xs={24} md={12}>
          <Card>
            <div className="flex items-center justify-between mb-3">
              <Segmented options={[{label:'全部', value:'all'},{label:'控制系统', value:'控制系统'},{label:'通信', value:'通信'},{label:'新能源汽车', value:'新能源汽车'}]} value={category} onChange={v=>setCategory(v as string)} />
              <Input placeholder="搜索节点" value={search} onChange={e=>setSearch(e.target.value)} style={{ maxWidth: 220 }} />
            </div>
            <List
              dataSource={filtered}
              renderItem={(n) => (
                <List.Item onClick={() => setSelected(n)} className="cursor-pointer">
                  <div className="flex items-center justify-between w-full">
                    <Typography.Text strong>{n.label}</Typography.Text>
                    <Tag>{n.category}</Tag>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title={selected ? `节点详情：${selected.label}` : '选择左侧节点查看详情'}>
            {!selected ? (
              <div className="text-gray-500">支持查看关联关系与快捷跳转相关项目</div>
            ) : (
              <>
                <Typography.Text type="secondary">类别：{selected.category}</Typography.Text>
                <div className="mt-3">
                  <Typography.Text strong>关联节点</Typography.Text>
                  <List
                    className="mt-2"
                    dataSource={neighbors}
                    renderItem={m => (
                      <List.Item>
                        <div className="flex items-center justify-between w-full">
                          <span>{m.label}</span>
                          <Tag>{m.category}</Tag>
                        </div>
                      </List.Item>
                    )}
                  />
                </div>
                <div className="mt-3">
                  <Button onClick={() => nav('/education/projects')}>打开相关项目</Button>
                </div>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </MainLayout>
  )
}
