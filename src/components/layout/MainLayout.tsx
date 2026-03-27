import { Layout } from 'antd'
import Header from './Header'
import { PropsWithChildren } from 'react'

export default function MainLayout({ children }: PropsWithChildren) {
  return (
    <Layout style={{ minHeight: '100vh' }} className="bg-slate-100">
      <Header />
      <Layout.Content className="!p-0 bg-slate-100">{children}</Layout.Content>
    </Layout>
  )
}
