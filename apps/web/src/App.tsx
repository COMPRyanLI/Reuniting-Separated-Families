import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Loading, RequirePerson, RequireSession, RequireVerifiedStaff } from './components/guards';
import { SessionProvider } from './lib/session';
import { HomePage } from './pages/HomePage';

// Route-level code splitting keeps the first page light on slow connections.
function named<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(async () => ({ default: (await load())[name] }));
}
const HelpPage = named(() => import('./pages/HelpPage'), 'HelpPage');
const NotFoundPage = named(() => import('./pages/NotFoundPage'), 'NotFoundPage');
const SignUpPage = named(() => import('./pages/auth/SignUpPage'), 'SignUpPage');
const SignInPage = named(() => import('./pages/auth/SignInPage'), 'SignInPage');
const RecoverPage = named(() => import('./pages/auth/RecoverPage'), 'RecoverPage');
const SignedOutPage = named(() => import('./pages/auth/SignedOutPage'), 'SignedOutPage');
const DashboardPage = named(() => import('./pages/DashboardPage'), 'DashboardPage');
const AccountPage = named(() => import('./pages/AccountPage'), 'AccountPage');
const SheltersPage = named(() => import('./pages/SheltersPage'), 'SheltersPage');
const CheckInsPage = named(() => import('./pages/CheckInsPage'), 'CheckInsPage');
const PrivacyPage = named(() => import('./pages/PrivacyPage'), 'PrivacyPage');
const NotificationsPage = named(() => import('./pages/NotificationsPage'), 'NotificationsPage');
const FindSomeonePage = named(() => import('./pages/requests/FindSomeonePage'), 'FindSomeonePage');
const OutgoingPage = named(() => import('./pages/requests/OutgoingPage'), 'OutgoingPage');
const IncomingPage = named(() => import('./pages/requests/IncomingPage'), 'IncomingPage');
const SharedListPage = named(() => import('./pages/requests/SharedPages'), 'SharedListPage');
const SharedDetailPage = named(() => import('./pages/requests/SharedPages'), 'SharedDetailPage');
const SharingPage = named(() => import('./pages/requests/SharingPage'), 'SharingPage');
const StaffVerifyPage = named(() => import('./pages/staff/StaffVerifyPage'), 'StaffVerifyPage');
const StaffHomePage = named(() => import('./pages/staff/StaffHomePage'), 'StaffHomePage');
const IntakePage = named(() => import('./pages/staff/IntakePage'), 'IntakePage');
const CaseWorkspacePage = named(() => import('./pages/staff/CaseWorkspacePage'), 'CaseWorkspacePage');
const CaseResponsePage = named(() => import('./pages/staff/CaseResponsePage'), 'CaseResponsePage');
const RouteTaskPage = named(() => import('./pages/staff/RouteTaskPage'), 'RouteTaskPage');

// Private data is never persisted; queries refetch on mount and are cleared on sign-out.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 0, gcTime: 60_000 },
    mutations: { retry: false },
  },
});

const page = (node: ReactNode) => <Suspense fallback={<Loading />}>{node}</Suspense>;

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="help" element={page(<HelpPage />)} />
              <Route path="signup" element={page(<SignUpPage />)} />
              <Route path="signin" element={page(<SignInPage />)} />
              <Route path="recover" element={page(<RecoverPage />)} />
              <Route path="signed-out" element={page(<SignedOutPage />)} />
              <Route path="shelters" element={page(<SheltersPage />)} />
              <Route path="check-ins" element={page(<RequirePerson><CheckInsPage /></RequirePerson>)} />
              <Route path="privacy" element={page(<RequirePerson><PrivacyPage /></RequirePerson>)} />
              <Route path="dashboard" element={page(<RequirePerson><DashboardPage /></RequirePerson>)} />
              <Route path="requests/new" element={page(<RequirePerson><FindSomeonePage /></RequirePerson>)} />
              <Route path="requests/outgoing" element={page(<RequirePerson><OutgoingPage /></RequirePerson>)} />
              <Route path="requests/incoming" element={page(<RequirePerson><IncomingPage /></RequirePerson>)} />
              <Route path="shared" element={page(<RequirePerson><SharedListPage /></RequirePerson>)} />
              <Route path="shared/:responseId" element={page(<RequirePerson><SharedDetailPage /></RequirePerson>)} />
              <Route path="sharing" element={page(<RequirePerson><SharingPage /></RequirePerson>)} />
              <Route path="notifications" element={page(<RequireSession><NotificationsPage /></RequireSession>)} />
              <Route path="account" element={page(<RequireSession><AccountPage /></RequireSession>)} />
              <Route path="staff/verify" element={page(<RequireSession><StaffVerifyPage /></RequireSession>)} />
              <Route path="staff" element={page(<RequireVerifiedStaff><StaffHomePage /></RequireVerifiedStaff>)} />
              <Route path="staff/intake" element={page(<RequireVerifiedStaff><IntakePage /></RequireVerifiedStaff>)} />
              <Route path="staff/cases/:caseId" element={page(<RequireVerifiedStaff><CaseWorkspacePage /></RequireVerifiedStaff>)} />
              <Route path="staff/cases/:caseId/responses/:responseId" element={page(<RequireVerifiedStaff><CaseResponsePage /></RequireVerifiedStaff>)} />
              <Route path="staff/routes/:routeId" element={page(<RequireVerifiedStaff><RouteTaskPage /></RequireVerifiedStaff>)} />
              <Route path="*" element={page(<NotFoundPage />)} />
            </Route>
          </Routes>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
