import { Link } from 'react-router-dom'
import MainLayout from '@components/layout/MainLayout'
import './Home.css'

// 学术精致风首页
export default function Home() {
  return (
    <MainLayout>
      <div className="home-container">
        {/* 顶部装饰线 */}
        <div className="top-accent-line" />

        {/* Hero 区域 */}
        <section className="hero-section">
          <div className="hero-badge">🚀 工程教育平台</div>
          <h1 className="hero-title">
            <span className="title-main">Simul</span>
            <span className="title-accent">earn</span>
          </h1>
          <p className="hero-subtitle">
            从学习到实践的完整闭环<br />
            <span className="subtitle-highlight">项目沙盒</span> × <span className="subtitle-highlight">智能助手</span> × <span className="subtitle-highlight">知识图谱</span>
          </p>
          <p className="hero-description">
            助力中国工程师快速成长，基于真实工业案例的交互式实战环境
          </p>
          <div className="hero-actions">
            <Link to="/education/projects" className="btn-primary">
              <span className="btn-icon">📚</span>
              开始学习
            </Link>
            <Link to="/ai-assistant/chat" className="btn-secondary">
              <span className="btn-icon">💬</span>
              向AI提问
            </Link>
          </div>
        </section>

        {/* 数据统计 */}
        <section className="stats-section">
          <div className="stat-item">
            <span className="stat-number">50+</span>
            <span className="stat-label">实训项目</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-number">12</span>
            <span className="stat-label">知识模块</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-number">AI</span>
            <span className="stat-label">智能辅导</span>
          </div>
        </section>

        {/* 核心价值 */}
        <section className="features-section">
          <h2 className="section-title">核心价值</h2>
          <div className="features-grid">
            <div className="feature-card feature-card--primary">
              <div className="feature-icon">🎯</div>
              <h3 className="feature-title">交互式项目沙盒</h3>
              <p className="feature-desc">基于真实工业案例的「填空式」实战环境，即时闭环反馈，让学习看得见摸得着</p>
              <div className="feature-tag">即时反馈</div>
            </div>

            <div className="feature-card feature-card--accent">
              <div className="feature-icon">🤖</div>
              <h3 className="feature-title">AI建模助手</h3>
              <p className="feature-desc">自然语言生成模型，闭环验证与修正，确保结果可靠可信</p>
              <div className="feature-tag">智能生成</div>
            </div>

            <div className="feature-card feature-card--highlight">
              <div className="feature-icon">🧭</div>
              <h3 className="feature-title">知识图谱导航</h3>
              <p className="feature-desc">可视化网络图，系统化探索概念与模块关联，构建完整知识体系</p>
              <div className="feature-tag">系统化学习</div>
            </div>
          </div>
        </section>

        {/* 快速入口 */}
        <section className="quick-access-section">
          <h2 className="section-title">快速开始</h2>
          <div className="quick-access-grid">
            <Link to="/education/projects" className="quick-card">
              <div className="quick-icon">⚡</div>
              <div className="quick-content">
                <h4>项目实训</h4>
                <p>选择一个项目开始学习</p>
              </div>
              <span className="quick-arrow">→</span>
            </Link>

            <Link to="/ai-assistant/chat" className="quick-card">
              <div className="quick-icon">🔬</div>
              <div className="quick-content">
                <h4>AI助手</h4>
                <p>有问题随时提问</p>
              </div>
              <span className="quick-arrow">→</span>
            </Link>

            <Link to="/knowledge/graph" className="quick-card">
              <div className="quick-icon">🗺️</div>
              <div className="quick-content">
                <h4>知识图谱</h4>
                <p>探索知识点关联</p>
              </div>
              <span className="quick-arrow">→</span>
            </Link>
          </div>
        </section>

        {/* 底部装饰 */}
        <div className="bottom-decoration">
          <div className="deco-line" />
          <span className="deco-text">Simulearn · 让学习更高效</span>
          <div className="deco-line" />
        </div>
      </div>
    </MainLayout>
  )
}
