import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, HOME } from './auth.jsx';
import Layout from './Layout.jsx';
import Login from './pages/Login.jsx';
import Book from './pages/Book.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Appointments from './pages/Appointments.jsx';
import Consultation from './pages/Consultation.jsx';
import Patients from './pages/Patients.jsx';
import PatientRecord from './pages/PatientRecord.jsx';
import Medicines from './pages/Medicines.jsx';
import Slips from './pages/Slips.jsx';
import Notifications from './pages/Notifications.jsx';
import { Loading } from './ui.jsx';

function Guard({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) return <Navigate to={HOME[user.role]} replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Starting CliniCare…" />;
  return (
    <Routes>
      <Route path="/book" element={<Book />} />
      <Route path="/login" element={user ? <Navigate to={HOME[user.role]} replace /> : <Login />} />
      {user ? (
        <Route element={<Layout />}>
          <Route index element={<Navigate to={HOME[user.role]} replace />} />
          <Route path="/dashboard" element={<Guard roles={['admin']}><Dashboard /></Guard>} />
          <Route path="/appointments" element={<Guard roles={['admin', 'doctor']}><Appointments /></Guard>} />
          <Route path="/consultation/:id" element={<Guard roles={['doctor']}><Consultation /></Guard>} />
          <Route path="/patients" element={<Guard roles={['admin', 'doctor']}><Patients /></Guard>} />
          <Route path="/patients/:id" element={<Guard roles={['admin', 'doctor']}><PatientRecord /></Guard>} />
          <Route path="/stock" element={<Guard roles={['admin', 'doctor']}><Medicines /></Guard>} />
          <Route path="/inventory" element={<Guard roles={['pharmacist']}><Medicines editable /></Guard>} />
          <Route path="/slips" element={<Guard roles={['pharmacist']}><Slips /></Guard>} />
          <Route path="/notifications" element={<Guard roles={['admin', 'doctor']}><Notifications /></Guard>} />
          <Route path="*" element={<Navigate to={HOME[user.role]} replace />} />
        </Route>
      ) : (
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}
    </Routes>
  );
}
