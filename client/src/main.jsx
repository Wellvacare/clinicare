import { StrictMode, Component } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { ToastProvider } from './ui.jsx';

class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div><h1 className="text-xl font-bold">Something went wrong</h1><p className="mt-2 text-slate-500">Please reload the page. If it keeps happening, contact support.</p>
          <button className="mt-4 rounded-xl bg-brand-600 px-4 py-2 text-white" onClick={() => location.reload()}>Reload</button></div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode><Boundary><BrowserRouter><ToastProvider><AuthProvider><App /></AuthProvider></ToastProvider></BrowserRouter></Boundary></StrictMode>,
);
