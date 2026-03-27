import api from './api'

export interface Project {
  id: string
  title: string
  description: string
  industry: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  duration: number // minutes
  rating: number
  cover: string
  tags: string[]
  objectives: string[]
  prerequisites: string[]
}

export async function fetchProjects(params?: { industry?: string; difficulty?: string; search?: string }): Promise<Project[]> {
  const all: Project[] = [
    {
      id: '1',
      title: '新能源汽车BMS建模',
      description: '基于真实工业案例的交互式学习体验，帮助用户快速掌握Simulink建模核心技能。',
      industry: '新能源汽车',
      difficulty: 'beginner',
      duration: 60,
      rating: 4.8,
      cover: `https://trae-api-sg.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent('新能源汽车电池管理系统 Simulink')}&image_size=square`,
      tags: ['新能源汽车', 'BMS'],
      objectives: ['理解BMS建模流程', '掌握Simulink常用模块'],
      prerequisites: ['Simulink基础', '电池原理']
    },
    {
      id: '2',
      title: '5G通信系统仿真',
      description: '通过5G链路级仿真项目，学习通信系统建模与性能评估方法。',
      industry: '通信',
      difficulty: 'intermediate',
      duration: 90,
      rating: 4.6,
      cover: `https://trae-api-sg.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent('5G通信系统 Simulink')}&image_size=square`,
      tags: ['5G', '通信'],
      objectives: ['搭建5G链路模型', '分析系统性能'],
      prerequisites: ['数字通信', 'Simulink进阶']
    }
  ]
  let list = all
  if (params?.industry) list = list.filter(p => p.industry === params.industry)
  if (params?.difficulty) list = list.filter(p => p.difficulty === params.difficulty)
  if (params?.search) {
    const q = params.search.trim()
    if (q) list = list.filter(p => [p.title, p.description, ...(p.tags||[])].join(' ').includes(q))
  }
  return Promise.resolve(list)
}

export async function fetchProject(id: string): Promise<Project | null> {
  const list = await fetchProjects()
  return list.find(p => p.id === id) || null
}
