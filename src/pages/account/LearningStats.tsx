import { Typography, Card, Row, Col, Segmented } from 'antd'
import MainLayout from '@components/layout/MainLayout'
import { useState } from 'react'
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, BarChart, Bar, PieChart, Pie, Cell } from 'recharts'

export default function LearningStats() {
  const [view, setView] = useState<'week' | 'month'>('week')
  const weekly = [
    { name: '周一', hours: 2.5, score: 85 },
    { name: '周二', hours: 3.2, score: 88 },
    { name: '周三', hours: 1.8, score: 82 },
    { name: '周四', hours: 4.1, score: 91 },
    { name: '周五', hours: 2.9, score: 87 },
    { name: '周六', hours: 3.5, score: 89 },
    { name: '周日', hours: 2.2, score: 84 }
  ]
  const monthly = [
    { name: '1月', hours: 45, avgScore: 82 },
    { name: '2月', hours: 52, avgScore: 85 },
    { name: '3月', hours: 38, avgScore: 79 },
    { name: '4月', hours: 61, avgScore: 88 },
    { name: '5月', hours: 55, avgScore: 86 },
    { name: '6月', hours: 67, avgScore: 91 }
  ]
  const skills = [
    { name: '控制系统', value: 35, color: '#8884d8' },
    { name: '信号处理', value: 25, color: '#82ca9d' },
    { name: '通信系统', value: 20, color: '#ffc658' },
    { name: '电力电子', value: 15, color: '#ff7300' },
    { name: '其他', value: 5, color: '#00ff88' }
  ]
  
  return (
    <MainLayout>
      <Typography.Title level={3}>学习统计</Typography.Title>
      <Card title={<Segmented options={[{label:'周视图', value:'week'},{label:'月视图', value:'month'}]} value={view} onChange={v => setView(v as any)} />}>
        <Row gutter={[24,24]}>
          <Col xs={24} lg={16}>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                {view==='week' ? (
                  <LineChart data={weekly}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="hours" stroke="#8884d8" name="学习时长(小时)" />
                    <Line type="monotone" dataKey="score" stroke="#82ca9d" name="平均得分" />
                  </LineChart>
                ) : (
                  <BarChart data={monthly}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="hours" fill="#8884d8" name="学习时长(小时)" />
                    <Bar dataKey="avgScore" fill="#82ca9d" name="平均得分" />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </Col>
          <Col xs={24} lg={8}>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={skills} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value">
                    {skills.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => [`${v}%`, '占比']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Col>
        </Row>
      </Card>
    </MainLayout>
  )
}
