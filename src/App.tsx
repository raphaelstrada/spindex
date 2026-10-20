import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireAdmin } from '@/components/AuthProvider'
import AdminPage from '@/pages/AdminPage'
import LoginPage from '@/pages/LoginPage'
import StorefrontPage from '@/pages/StorefrontPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/spindex">
        <Routes>
          <Route path="/" element={<StorefrontPage />} />
          <Route path="/admin/login" element={<LoginPage />} />
          <Route
            path="/admin"
            element={(
              <RequireAdmin>
                <AdminPage />
              </RequireAdmin>
            )}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
