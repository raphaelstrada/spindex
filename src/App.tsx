import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireAdmin } from '@/components/AuthProvider'
import AdminPage from '@/pages/AdminPage'
import LoginPage from '@/pages/LoginPage'
import StorefrontPage from '@/pages/StorefrontPage'
import ProductPage from '@/pages/ProductPage'
import BagPage from '@/pages/BagPage'
import OrderSuccessPage from '@/pages/OrderSuccessPage'
import StorefrontLayout from '@/components/storefront/StorefrontLayout'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/spindex">
        <Routes>
          <Route element={<StorefrontLayout />}>
            <Route path="/" element={<StorefrontPage />} />
            <Route path="/record/:id" element={<ProductPage />} />
            <Route path="/bag" element={<BagPage />} />
            <Route path="/order/success" element={<OrderSuccessPage />} />
          </Route>
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
