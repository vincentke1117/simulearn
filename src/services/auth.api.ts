import api from './api'

export interface LoginParams {
  email: string
  password: string
}

export interface RegisterParams {
  username: string
  email: string
  password: string
}

export interface AuthResponse {
  token: string
  user: { id: string; username: string; email: string; role: string }
}

export async function login(params: LoginParams): Promise<AuthResponse> {
  if (params.email === 'admin@example.com') {
    return Promise.resolve({
      token: 'mock-admin-token',
      user: { id: 'admin-1', username: 'Admin', email: 'admin@example.com', role: 'admin' }
    })
  }
  return Promise.resolve({
    token: 'mock-jwt-token',
    user: { id: '1', username: 'MockUser', email: params.email, role: 'student' }
  })
}

export async function register(params: RegisterParams): Promise<AuthResponse> {
  // TODO: replace with real endpoint
  return Promise.resolve({
    token: 'mock-jwt-token',
    user: { id: '1', username: params.username, email: params.email, role: 'student' }
  })
}
