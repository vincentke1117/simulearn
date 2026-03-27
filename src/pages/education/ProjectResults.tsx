import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Typography, Card, Button, Progress, Rate, Tag, List, Avatar, Space, Divider, Row, Col } from 'antd'
import { DownloadOutlined, EyeOutlined, ArrowRightOutlined, TrophyOutlined, CheckCircleOutlined, ClockCircleOutlined, StarOutlined } from '@ant-design/icons'
import MainLayout from '@components/layout/MainLayout'

interface ScoreBreakdown {
  category: string
  score: number
  maxScore: number
  feedback: string
}

interface AISuggestion {
  id: string
  type: 'strength' | 'improvement' | 'tip'
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
}

export default function ProjectResults() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [downloading, setDownloading] = useState(false)

  const [totalScore, setTotalScore] = useState(85)
  const maxScore = 100
  const [completionTime, setCompletionTime] = useState(45)
  const [accuracy, setAccuracy] = useState(92)
  const [completedTasksInfo, setCompletedTasksInfo] = useState<{completed:number; total:number} | null>(null)

  useEffect(() => {
    try {
      const resStr = localStorage.getItem(`results:${projectId}`)
      if (resStr) {
        const res = JSON.parse(resStr)
        if (typeof res.accuracy === 'number') setAccuracy(res.accuracy)
        if (typeof res.completedTasks === 'number' && typeof res.totalTasks === 'number') {
          setCompletedTasksInfo({ completed: res.completedTasks, total: res.totalTasks })
          const score = Math.min(100, Math.round(70 + (res.accuracy * 0.3)))
          setTotalScore(score)
        }
        if (res.completedAt) {
          setCompletionTime(45)
        }
      }
    } catch {}
  }, [projectId])

  const scoreBreakdown: ScoreBreakdown[] = [
    {
      category: '模型构建',
      score: 28,
      maxScore: 30,
      feedback: '模型结构完整，组件连接正确'
    },
    {
      category: '参数配置',
      score: 22,
      maxScore: 25,
      feedback: '参数设置合理，仿真步长选择恰当'
    },
    {
      category: '仿真结果',
      score: 20,
      maxScore: 25,
      feedback: '结果分析基本正确，响应曲线合理'
    },
    {
      category: '报告质量',
      score: 15,
      maxScore: 20,
      feedback: '报告结构清晰，但可以增加更多分析'
    }
  ]

  const aiSuggestions: AISuggestion[] = [
    {
      id: '1',
      type: 'strength',
      title: '模型结构优秀',
      description: '您的系统模型构建非常规范，组件选择和连接都符合工程标准。',
      priority: 'high'
    },
    {
      id: '2',
      type: 'improvement',
      title: '参数调优空间',
      description: '建议尝试不同的PID参数组合，观察系统响应的变化。',
      priority: 'medium'
    },
    {
      id: '3',
      type: 'tip',
      title: '结果分析深度',
      description: '可以增加对超调量和稳态误差的定量分析。',
      priority: 'low'
    },
    {
      id: '4',
      type: 'improvement',
      title: '报告完整性',
      description: '建议在报告中加入对比分析，展示不同参数下的性能差异。',
      priority: 'medium'
    }
  ]

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-600'
    if (score >= 80) return 'text-blue-600'
    if (score >= 70) return 'text-orange-600'
    return 'text-red-600'
  }

  const getScoreLevel = (score: number) => {
    if (score >= 90) return '优秀'
    if (score >= 80) return '良好'
    if (score >= 70) return '中等'
    return '需要改进'
  }

  const getSuggestionIcon = (type: string) => {
    switch (type) {
      case 'strength': return <TrophyOutlined className="text-green-500" />
      case 'improvement': return <ArrowRightOutlined className="text-orange-500" />
      case 'tip': return <StarOutlined className="text-blue-500" />
      default: return <CheckCircleOutlined />
    }
  }

  const getSuggestionColor = (type: string) => {
    switch (type) {
      case 'strength': return 'border-green-200 bg-green-50'
      case 'improvement': return 'border-orange-200 bg-orange-50'
      case 'tip': return 'border-blue-200 bg-blue-50'
      default: return 'border-gray-200 bg-gray-50'
    }
  }

  const downloadReport = async () => {
    setDownloading(true)
    setTimeout(() => {
      setDownloading(false)
      const link = document.createElement('a')
      link.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(`项目报告 - ${projectId}\n综合得分: ${totalScore}/100\n完成时间: ${completionTime}分钟\n准确率: ${accuracy}%`)
      link.download = `项目报告_${projectId}_${new Date().toISOString().split('T')[0]}.txt`
      link.click()
    }, 2000)
  }

  const viewReference = () => {
    navigate(`/education/projects/${projectId}?tab=reference`)
  }

  return (
    <MainLayout>
      <div className="max-w-6xl mx-auto">
        <Typography.Title level={2} className="mb-6">
          项目完成报告 - #{projectId}
        </Typography.Title>

        
        <Card className="mb-6">
          <Row gutter={[32, 24]} align="middle">
            <Col xs={24} sm={8} className="text-center">
              <div className="mb-4">
                <Progress 
                  type="circle" 
                  percent={totalScore} 
                  size={160}
                  strokeColor={totalScore >= 90 ? '#52c41a' : totalScore >= 80 ? '#1890ff' : totalScore >= 70 ? '#fa8c16' : '#ff4d4f'}
                  format={() => (
                    <div className="text-center">
                      <div className={`text-4xl font-bold ${getScoreColor(totalScore)}`}>
                        {totalScore}
                      </div>
                      <div className="text-gray-500 text-sm">总分</div>
                    </div>
                  )}
                />
              </div>
              <Typography.Title level={4} className={`${getScoreColor(totalScore)} mb-2`}>
                {getScoreLevel(totalScore)}
              </Typography.Title>
              <Typography.Text type="secondary">
                完成时间: {completionTime} 分钟
              </Typography.Text>
            </Col>
            
            <Col xs={24} sm={16}>
              <Typography.Title level={4} className="mb-4">详细评分</Typography.Title>
              <List
                dataSource={scoreBreakdown}
                renderItem={item => (
                  <List.Item className="px-0">
                    <div className="w-full">
                      <div className="flex justify-between items-center mb-2">
                        <Typography.Text strong>{item.category}</Typography.Text>
                        <Typography.Text type="secondary">
                          {item.score}/{item.maxScore}
                        </Typography.Text>
                      </div>
                      <Progress 
                        percent={(item.score / item.maxScore) * 100} 
                        size="small"
                        showInfo={false}
                        strokeColor={item.score >= item.maxScore * 0.9 ? '#52c41a' : '#1890ff'}
                      />
                      <Typography.Text type="secondary" className="text-sm mt-1">
                        {item.feedback}
                      </Typography.Text>
                    </div>
                  </List.Item>
                )}
              />
            </Col>
          </Row>
        </Card>

        
        <Card title="🤖 AI专家点评" className="mb-6">
          <Typography.Paragraph type="secondary" className="mb-6">
            基于您的项目表现，AI导师为您提供以下个性化建议：
          </Typography.Paragraph>
          
          <Row gutter={[16, 16]}>
            {aiSuggestions.map(suggestion => (
              <Col xs={24} md={12} key={suggestion.id}>
                <div className={`p-4 rounded-lg border-2 ${getSuggestionColor(suggestion.type)}`}>
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      {getSuggestionIcon(suggestion.type)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Typography.Text strong>{suggestion.title}</Typography.Text>
                        <Tag 
                          color={suggestion.priority === 'high' ? 'red' : suggestion.priority === 'medium' ? 'orange' : 'default'}
                          size="small"
                        >
                          {suggestion.priority === 'high' ? '高优先级' : suggestion.priority === 'medium' ? '中优先级' : '低优先级'}
                        </Tag>
                      </div>
                      <Typography.Text type="secondary" className="text-sm">
                        {suggestion.description}
                      </Typography.Text>
                    </div>
                  </div>
                </div>
              </Col>
            ))}
          </Row>

          <Divider />

          <div className="bg-blue-50 p-4 rounded-lg">
            <Typography.Text strong className="text-blue-800 mb-2 block">
              📈 学习建议
            </Typography.Text>
            <Typography.Text className="text-blue-700">
              您在本项目中表现良好！建议继续学习PID控制器调优和系统稳定性分析相关内容，
              这将帮助您在更复杂的控制系统项目中取得更好成绩。
            </Typography.Text>
          </div>
        </Card>

        
        <Card title="📊 项目统计" className="mb-6">
          <Row gutter={[32, 24]}>
            <Col xs={12} sm={6} className="text-center">
              <Typography.Title level={2} className="text-green-600 mb-2">
                {accuracy}%
              </Typography.Title>
              <Typography.Text type="secondary">模型准确率</Typography.Text>
            </Col>
            <Col xs={12} sm={6} className="text-center">
              <Typography.Title level={2} className="text-blue-600 mb-2">
                {completionTime}
              </Typography.Title>
              <Typography.Text type="secondary">完成时间(分钟)</Typography.Text>
            </Col>
            <Col xs={12} sm={6} className="text-center">
              <Typography.Title level={2} className="text-orange-600 mb-2">
                {completedTasksInfo ? `${completedTasksInfo.completed}/${completedTasksInfo.total}` : '4/4'}
              </Typography.Title>
              <Typography.Text type="secondary">任务完成数</Typography.Text>
            </Col>
            <Col xs={12} sm={6} className="text-center">
              <Typography.Title level={2} className="text-purple-600 mb-2">
                2
              </Typography.Title>
              <Typography.Text type="secondary">重试次数</Typography.Text>
            </Col>
          </Row>
        </Card>

        
        <div className="flex flex-wrap gap-4 justify-center">
          <Button 
            icon={<EyeOutlined />}
            size="large"
            onClick={viewReference}
          >
            查看参考答案
          </Button>
          <Button 
            icon={<DownloadOutlined />}
            size="large"
            loading={downloading}
            onClick={downloadReport}
          >
            {downloading ? '生成报告中...' : '下载报告'}
          </Button>
          <Button 
            size="large"
            onClick={() => window.print()}
          >
            导出PDF（打印）
          </Button>
          <Button 
            type="primary"
            icon={<ArrowRightOutlined />}
            size="large"
            onClick={() => navigate('/education/projects')}
          >
            继续学习
          </Button>
        </div>
      </div>
    </MainLayout>
  )
}
