import api from './api'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: { title: string; url: string }[]
}

export async function* streamChat(messages: ChatMessage[]): AsyncGenerator<ChatMessage, void, unknown> {
  // TODO: replace with real SSE endpoint
  await new Promise(r => setTimeout(r, 800))
  yield { role: 'assistant', content: '这是模拟流式回复，后续接入真实RAG与SSE。', sources: [{ title: 'Simulink官方文档', url: '#' }] }
}