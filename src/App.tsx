import { Routes, Route, Navigate } from 'react-router-dom'
import ErrorBoundary from '@components/ErrorBoundary'
import RouteGuard from '@components/RouteGuard'
import Home from '@pages/Home'
import Login from '@pages/auth/Login'
import Register from '@pages/auth/Register'
import ResetPassword from '@pages/auth/ResetPassword'
import Dashboard from '@pages/Dashboard'
import ProjectsList from '@pages/education/ProjectsList'
import ProjectDetail from '@pages/education/ProjectDetail'
import ProjectWorkspace from '@pages/education/ProjectWorkspace'
import ProjectResults from '@pages/education/ProjectResults'
import LearningPath from '@pages/education/LearningPath'
import Chat from '@pages/ai/Chat'
import Profile from '@pages/account/Profile'
import LearningStats from '@pages/account/LearningStats'
import MyProjects from '@pages/account/MyProjects'
import Subscriptions from '@pages/account/Subscriptions'
import Settings from '@pages/account/Settings'
import CommunityExplore from '@pages/community/Explore'
import Questions from '@pages/community/Questions'
import QuestionDetail from '@pages/community/QuestionDetail'
import AdminPanel from '@pages/admin/AdminPanel'
import TeacherPortal from '@pages/teacher/Portal'
import Favorites from '@pages/account/Favorites'
import KnowledgeGraph from '@pages/knowledge/Graph'
import FaultDebug from '@pages/training/FaultDebug'

export default function App() {
  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth/login" element={<Login />} />
      <Route path="/auth/register" element={<Register />} />
      <Route path="/auth/reset-password" element={<ResetPassword />} />
      
      <Route path="/dashboard" element={<RouteGuard><Dashboard /></RouteGuard>} />
      <Route path="/education/projects" element={<RouteGuard><ProjectsList /></RouteGuard>} />
      <Route path="/education/learning-path" element={<RouteGuard><LearningPath /></RouteGuard>} />
      <Route path="/education/projects/:projectId" element={<RouteGuard><ProjectDetail /></RouteGuard>} />
      <Route path="/education/projects/:projectId/workspace" element={<RouteGuard><ProjectWorkspace /></RouteGuard>} />
      <Route path="/education/projects/:projectId/results" element={<RouteGuard><ProjectResults /></RouteGuard>} />
      <Route path="/ai-assistant/chat" element={<RouteGuard><Chat /></RouteGuard>} />
      <Route path="/account/profile" element={<RouteGuard><Profile /></RouteGuard>} />
      <Route path="/account/learning-stats" element={<RouteGuard><LearningStats /></RouteGuard>} />
      <Route path="/account/my-projects" element={<RouteGuard><MyProjects /></RouteGuard>} />
      <Route path="/account/favorites" element={<RouteGuard><Favorites /></RouteGuard>} />
      <Route path="/account/subscriptions" element={<RouteGuard><Subscriptions /></RouteGuard>} />
      <Route path="/account/settings" element={<RouteGuard><Settings /></RouteGuard>} />
      <Route path="/community/explore" element={<RouteGuard><CommunityExplore /></RouteGuard>} />
      <Route path="/community/questions" element={<RouteGuard><Questions /></RouteGuard>} />
      <Route path="/community/questions/:qid" element={<RouteGuard><QuestionDetail /></RouteGuard>} />
      <Route path="/admin" element={<RouteGuard roles={["admin"]}><AdminPanel /></RouteGuard>} />
      <Route path="/teacher" element={<RouteGuard roles={["admin"]}><TeacherPortal /></RouteGuard>} />
      <Route path="/knowledge/graph" element={<RouteGuard><KnowledgeGraph /></RouteGuard>} />
      <Route path="/training/fault-debug" element={<RouteGuard><FaultDebug /></RouteGuard>} />
      
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
    </ErrorBoundary>
  )
}
