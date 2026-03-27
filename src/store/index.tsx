import { configureStore, createSlice, PayloadAction } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'

interface User {
  id: string
  username: string
  email: string
  role: string
}

interface UserState {
  token: string
  user: User | null
}

const initialState: UserState = { token: '', user: null }

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setAuth(state, action: PayloadAction<{ token: string; user: User }>) {
      state.token = action.payload.token
      state.user = action.payload.user
      localStorage.setItem('token', action.payload.token)
      try { localStorage.setItem('user', JSON.stringify(action.payload.user)) } catch {}
    },
    logout(state) {
      state.token = ''
      state.user = null
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    }
  }
})

export const { setAuth, logout } = userSlice.actions

export const store = configureStore({
  reducer: { user: userSlice.reducer }
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export function withStore(children: React.ReactNode) {
  return <Provider store={store}>{children}</Provider>
}
