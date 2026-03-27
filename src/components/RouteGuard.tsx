import { Navigate, useLocation } from 'react-router-dom'
import { useAppSelector } from '@store/hooks'

interface RouteGuardProps {
  children: React.ReactNode
  roles?: string[]
}

export default function RouteGuard({ children, roles }: RouteGuardProps) {
  const { token, user } = useAppSelector(state => state.user)
  const location = useLocation()

  if (!token) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />
  }

  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
