import { useEffect, useState } from 'react'
import { Typography, Card, Row, Col, Button, Statistic, Segmented, Badge, Space, List } from 'antd'
import { fetchProjects } from '@services/projects.api'
import { BookOutlined, ClockCircleOutlined, TrophyOutlined, ArrowRightOutlined, RiseOutlined, CalendarOutlined } from '@ant-design/icons'
import MainLayout from '@components/layout/MainLayout'
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts'

const learningTrendData = [
  { name: '周一', hours: 2.5, projects: 1, score: 85 },
  { name: '周二', hours: 3.2, projects: 2, score: 88 },
  { name: '周三', hours: 1.8, projects: 1, score: 82 },
  { name: '周四', hours: 4.1, projects: 2, score: 91 },
  { name: '周五', hours: 2.9, projects: 1, score: 87 },
  { name: '周六', hours: 3.5, projects: 2, score: 89 },
  { name: '周日', hours: 2.2, projects: 1, score: 84 }
]

const monthlyData = [
  { month: '1月', hours: 45, projects: 8, avgScore: 82 },
  { month: '2月', hours: 52, projects: 10, avgScore: 85 },
  { month: '3月', hours: 38, projects: 6, avgScore: 79 },
  { month: '4月', hours: 61, projects: 12, avgScore: 88 },
  { month: '5月', hours: 55, projects: 11, avgScore: 86 },
  { month: '6月', hours: 67, projects: 14, avgScore: 91 }
]

const skillDistribution = [
  { name: '控制系统', value: 35, color: '#8884d8' },
  { name: '信号处理', value: 25, color: '#82ca9d' },
  { name: '通信系统', value: 20, color: '#ffc658' },
  { name: '电力电子', value: 15, color: '#ff7300' },
  { name: '其他', value: 5, color: '#00ff88' }
]

const recentProjects = [
  { name: '温度控制系统', progress: 100, score: 85, completedAt: '2024-01-15' },
  { name: '电机调速系统', progress: 80, score: 78, completedAt: '2024-01-14' },
  { name: '通信调制解调', progress: 100, score: 92, completedAt: '2024-01-13' },
  { name: '滤波器设计', progress: 60, score: 0, completedAt: null }
]

export default function Dashboard() {
  const [chartType, setChartType] = useState<'week' | 'month'>('week')
  const [chartMetric, setChartMetric] = useState<'hours' | 'projects' | 'score'>('hours')
  const [completedCount, setCompletedCount] = useState(12)
  const [avgScore, setAvgScore] = useState(87)
  const [weeklyHours, setWeeklyHours] = useState(36)
  const [favoriteTitles, setFavoriteTitles] = useState<string[]>([])
  const [pendingTasksCount, setPendingTasksCount] = useState(0)

  useEffect(() => {
    try {
      let count = 0
      let sumAcc = 0
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || ''
        if (key.startsWith('results:')) {
          const val = localStorage.getItem(key)
          if (!val) continue
          const obj = JSON.parse(val)
          if (typeof obj.accuracy === 'number') {
            sumAcc += obj.accuracy
          }
          count++
        }
      }
      if (count > 0) {
        setCompletedCount(count)
        setAvgScore(Math.round(70 + (sumAcc / count) * 0.3))
        setWeeklyHours(6 + count * 2)
      }
    } catch {}
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const favIds = JSON.parse(localStorage.getItem('favorites:projects')||'[]') as string[]
        const all = await fetchProjects()
        const titles = all.filter(p => favIds.includes(p.id)).slice(0,3).map(p => p.title)
        setFavoriteTitles(titles)
      } catch {}
    })()
    try {
      let pending = 0
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || ''
        if (key.startsWith('workspace:')) {
          const val = localStorage.getItem(key)
          if (!val) continue
          const obj = JSON.parse(val)
          if (Array.isArray(obj.tasks)) {
            pending += obj.tasks.filter((t: any) => !t.completed).length
          }
        }
      }
      setPendingTasksCount(pending)
    } catch {}
  }, [])

  const currentData = chartType === 'week' ? learningTrendData : monthlyData
  const xAxisKey = chartType === 'week' ? 'name' : 'month'

  const getChartData = () => {
    switch (chartMetric) {
      case 'hours':
        return { dataKey: chartType === 'week' ? 'hours' : 'hours', name: '学习时长', unit: '小时', color: '#8884d8' }
      case 'projects':
        return { dataKey: chartType === 'week' ? 'projects' : 'projects', name: '完成项目', unit: '个', color: '#82ca9d' }
      case 'score':
        return { dataKey: chartType === 'week' ? 'score' : 'avgScore', name: '平均得分', unit: '分', color: '#ffc658' }
      default:
        return { dataKey: 'hours', name: '学习时长', unit: '小时', color: '#8884d8' }
    }
  }

  const chartConfig = getChartData()

  return (
    <MainLayout>
      <Typography.Title level={3} className="flex items-center gap-2">
        <TrophyOutlined className="text-yellow-500" /> 用户主控制台
      </Typography.Title>
      
      
      <Row gutter={[24, 24]} className="mt-4">
        <Col xs={24} md={6}>
          <Card hoverable>
            <Statistic title="已完成项目" value={completedCount} suffix="/ 20" />
            <div className="mt-2 text-sm text-gray-600">继续加油，完成更多项目！</div>
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card hoverable>
            <Statistic title="学习时长" value={weeklyHours} suffix="小时" />
            <div className="mt-2 text-sm text-gray-600">本周已学习 6 小时</div>
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card hoverable>
            <Statistic title="平均得分" value={avgScore} suffix="分" />
            <div className="mt-2 text-sm text-gray-600">高于平均水平</div>
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card hoverable>
            <Statistic title="连续学习" value={7} suffix="天" />
            <div className="mt-2 text-sm text-gray-600">保持学习连续性！</div>
          </Card>
        </Col>
      </Row>

      
      <Card 
        title={
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <RiseOutlined /> 学习趋势分析
            </span>
            <Space>
              <Segmented
                options={[
                  { label: '周视图', value: 'week' },
                  { label: '月视图', value: 'month' }
                ]}
                value={chartType}
                onChange={(value) => setChartType(value as 'week' | 'month')}
                size="small"
              />
              <Segmented
                options={[
                  { label: '时长', value: 'hours' },
                  { label: '项目', value: 'projects' },
                  { label: '得分', value: 'score' }
                ]}
                value={chartMetric}
                onChange={(value) => setChartMetric(value as 'hours' | 'projects' | 'score')}
                size="small"
              />
            </Space>
          </div>
        }
        className="mt-6"
      >
        <Row gutter={[24, 24]}>
          <Col xs={24} lg={16}>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={currentData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey={xAxisKey} />
                  <YAxis />
                  <Tooltip 
                    formatter={(value) => [`${value} ${chartConfig.unit}`, chartConfig.name]}
                    labelFormatter={(label) => `${chartType === 'week' ? '日期' : '月份'}: ${label}`}
                  />
                  <Area 
                    type="monotone" 
                    dataKey={chartConfig.dataKey} 
                    stroke={chartConfig.color} 
                    fill={chartConfig.color}
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Col>
          <Col xs={24} lg={8}>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={skillDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {skillDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [`${value}%`, '占比']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-center mt-2">
                <Typography.Text strong>技能分布</Typography.Text>
              </div>
            </div>
          </Col>
        </Row>
      </Card>

      
      <Row gutter={[24, 24]} className="mt-6">
        <Col xs={24} md={12}>
          <Card 
            title={
              <span className="flex items-center gap-2">
                <CalendarOutlined /> 最近项目
              </span>
            }
            hoverable
          >
            <List
              dataSource={recentProjects}
              renderItem={item => (
                <List.Item className="px-0">
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                      <Badge 
                        status={item.progress === 100 ? 'success' : item.progress > 50 ? 'processing' : 'warning'} 
                      />
                      <div>
                        <Typography.Text strong>{item.name}</Typography.Text>
                        <div className="text-sm text-gray-500">
                          {item.progress === 100 ? `得分: ${item.score}分` : `进度: ${item.progress}%`}
                        </div>
                      </div>
                    </div>
                    <Typography.Text type="secondary" className="text-sm">
                      {item.completedAt ? item.completedAt : '进行中'}
                    </Typography.Text>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title={<span className="flex items-center gap-2"><BookOutlined /> 继续学习</span>} hoverable>
            <Typography.Title level={4}>新能源汽车BMS建模</Typography.Title>
            <p className="text-gray-600">完成度 60%</p>
            <Button type="primary" className="mt-3" icon={<ArrowRightOutlined />}>继续</Button>
          </Card>
          
          <Card title={<span className="flex items-center gap-2"><ClockCircleOutlined /> 推荐项目</span>} hoverable className="mt-4">
            <Typography.Title level={4}>5G通信系统仿真</Typography.Title>
            <p className="text-gray-600">预计 90 分钟</p>
            <Button className="mt-3" icon={<ArrowRightOutlined />}>开始</Button>
          </Card>
        </Col>
      </Row>

      
      <Card title="📊 本周学习统计" className="mt-6">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={learningTrendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="hours" fill="#8884d8" name="学习时长(小时)" />
              <Bar dataKey="projects" fill="#82ca9d" name="完成项目(个)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Row gutter={[24,24]} className="mt-6">
        <Col xs={24} md={12}>
          <Card title="最近收藏">
            {favoriteTitles.length === 0 ? (
              <div className="text-gray-500">暂无收藏</div>
            ) : (
              <ul className="list-disc pl-5">
                {favoriteTitles.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            )}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="待完成任务">
            <Typography.Title level={3}>{pendingTasksCount}</Typography.Title>
            <Typography.Text type="secondary">来自各项目工作区的未完成任务总数</Typography.Text>
          </Card>
        </Col>
      </Row>
    </MainLayout>
  )
}
