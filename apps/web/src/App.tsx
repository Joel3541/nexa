import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/app-shell';
import { LoadingState } from './components/ui/feedback';
import { useSession } from './store/session';

// Route-level code splitting: the landing page and the authenticated product
// are separate bundles, so a first-time visitor never downloads the app.
const Landing = lazy(() => import('./pages/landing'));
const SignIn = lazy(() => import('./pages/auth/sign-in'));
const SignUp = lazy(() => import('./pages/auth/sign-up'));
const ForgotPassword = lazy(() => import('./pages/auth/forgot-password'));
const ResetPassword = lazy(() => import('./pages/auth/reset-password'));
const Onboarding = lazy(() => import('./pages/onboarding'));
const Dashboard = lazy(() => import('./pages/dashboard'));
const Customers = lazy(() => import('./pages/customers/list'));
const CustomerDetail = lazy(() => import('./pages/customers/detail'));
const CustomerNew = lazy(() => import('./pages/customers/new'));
const Products = lazy(() => import('./pages/products/list'));
const ProductDetail = lazy(() => import('./pages/products/detail'));
const ProductNew = lazy(() => import('./pages/products/new'));
const Sales = lazy(() => import('./pages/sales/list'));
const SaleNew = lazy(() => import('./pages/sales/new'));
const SaleDetail = lazy(() => import('./pages/sales/detail'));
const Invoices = lazy(() => import('./pages/invoices/list'));
const InvoiceNew = lazy(() => import('./pages/invoices/new'));
const InvoiceDetail = lazy(() => import('./pages/invoices/detail'));
const Expenses = lazy(() => import('./pages/expenses'));
const Tasks = lazy(() => import('./pages/tasks'));
const Appointments = lazy(() => import('./pages/appointments'));
const Analytics = lazy(() => import('./pages/analytics'));
const Activity = lazy(() => import('./pages/activity'));
const Assistant = lazy(() => import('./pages/assistant'));
const Settings = lazy(() => import('./pages/settings'));

function Protected({ children }: { children: ReactNode }) {
  const { loading, isAuthenticated, needsOnboarding } = useSession();
  const location = useLocation();

  if (loading) return <FullPageLoading />;
  if (!isAuthenticated) return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />;
  if (needsOnboarding) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { loading, isAuthenticated, needsOnboarding } = useSession();
  if (loading) return <FullPageLoading />;
  if (isAuthenticated) return <Navigate to={needsOnboarding ? '/onboarding' : '/app'} replace />;
  return <>{children}</>;
}

function FullPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <LoadingState label="Loading NEXA…" />
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<FullPageLoading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route
          path="/sign-in"
          element={
            <PublicOnly>
              <SignIn />
            </PublicOnly>
          }
        />
        <Route
          path="/sign-up"
          element={
            <PublicOnly>
              <SignUp />
            </PublicOnly>
          }
        />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/onboarding" element={<Onboarding />} />

        <Route
          path="/app"
          element={
            <Protected>
              <AppShell />
            </Protected>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/new" element={<CustomerNew />} />
          <Route path="customers/:id" element={<CustomerDetail />} />
          <Route path="products" element={<Products />} />
          <Route path="products/new" element={<ProductNew />} />
          <Route path="products/:id" element={<ProductDetail />} />
          <Route path="sales" element={<Sales />} />
          <Route path="sales/new" element={<SaleNew />} />
          <Route path="sales/:id" element={<SaleDetail />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="invoices/new" element={<InvoiceNew />} />
          <Route path="invoices/:id" element={<InvoiceDetail />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="appointments" element={<Appointments />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="activity" element={<Activity />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
