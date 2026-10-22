import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router'
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
import { CharactersPage } from '@/pages/CharactersPage'
import { CharacterDetailPage } from '@/pages/CharacterDetailPage'
import { WorldPage } from '@/pages/WorldPage'
import { WorldElementPage } from '@/pages/WorldElementPage'
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
      <EmptyState title="Page not found" action={<Link className="link underline" to="/">Go to the dashboard</Link>}>
        This page does not exist.
      </EmptyState>
    </PageBody>
  )
}

/** Calm, palette-matched notifications. Hidden entirely while writing in Deep Focus. */
function ThemedToaster() {
  const { prefs } = usePreferences()
  const { pathname } = useLocation()
  if (prefs.writingMode === 'focus' && /\/write$/.test(pathname)) return null
  return (
    <Toaster
      theme={prefs.theme}
      position="bottom-right"
      closeButton
      toastOptions={{
        unstyled: false,
        classNames: {
          toast: '!bg-panel !text-fg !border !border-line !font-sans !shadow-lg',
          description: '!text-fg-muted',
          success: '[&_[data-icon]]:!text-progress-text',
          error: '!border-alert [&_[data-icon]]:!text-alert-text',
          closeButton: '!bg-panel !text-fg !border-control',
        },
      }}
    />
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PreferencesProvider>
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
                <Route path="characters" element={<CharactersPage />} />
                <Route path="characters/:characterId" element={<CharacterDetailPage />} />
                <Route path="world" element={<WorldPage />} />
                <Route path="world/:elementId" element={<WorldElementPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
            <ThemedToaster />
          </BrowserRouter>
        </PreferencesProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
