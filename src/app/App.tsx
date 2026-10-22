import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/contexts/AuthContext'
import { PreferencesProvider, usePreferences } from '@/contexts/PreferencesContext'
import { AppShell, PageBody } from '@/components/layout/AppShell'
import { ForgotPasswordPage, LoginPage, RequireAuth, ResetPasswordPage } from '@/pages/auth/AuthPages'
import { DashboardPage } from '@/pages/DashboardPage'
import { LibraryPage } from '@/pages/LibraryPage'
import { BookDetailPage } from '@/pages/BookDetailPage'
import { StudioIndexPage } from '@/pages/StudioIndexPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { EmptyState, PageLoader } from '@/components/ui/feedback'

// The editor bundle is large, so it loads only when the Writing Studio opens.
const WritingStudioPage = lazy(() => import('@/pages/WritingStudioPage').then((m) => ({ default: m.WritingStudioPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: 0 },
  },
})

function NotFound() {
  return (
    <PageBody>
      <EmptyState title="Page not found" action={<Link className="text-plum underline" to="/">Go to the dashboard</Link>}>
        This page does not exist.
      </EmptyState>
    </PageBody>
  )
}

function ThemedToaster() {
  const { prefs } = usePreferences()
  return <Toaster theme={prefs.theme} position="bottom-right" richColors closeButton />
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route
                path="/books/:bookId/write"
                element={
                  <RequireAuth>
                    <Suspense fallback={<PageLoader label="Opening Writing Studio" />}>
                      <WritingStudioPage />
                    </Suspense>
                  </RequireAuth>
                }
              />
              <Route
                element={
                  <RequireAuth>
                    <AppShell />
                  </RequireAuth>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="library" element={<LibraryPage />} />
                <Route path="books/:bookId" element={<BookDetailPage />} />
                <Route path="studio" element={<StudioIndexPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </BrowserRouter>
          <ThemedToaster />
        </AuthProvider>
      </PreferencesProvider>
    </QueryClientProvider>
  )
}
