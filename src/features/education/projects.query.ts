import { useQuery } from '@tanstack/react-query'
import { fetchProjects, fetchProject, Project } from '@services/projects.api'

export function useProjects(params?: { industry?: string; difficulty?: string; search?: string }) {
  return useQuery<Project[]>({
    queryKey: ['projects', params],
    queryFn: () => fetchProjects(params)
  })
}

export function useProject(id: string) {
  return useQuery<Project | null>({
    queryKey: ['project', id],
    queryFn: () => fetchProject(id)
  })
}