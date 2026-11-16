import { t } from './i18n';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './sidepanel/App';
import './styles.css';
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main><h1>{t('Unable to open Workday')}</h1><p>{t('Your data has not been deleted. Reload the panel to try again.')}</p><button onClick={() => location.reload()}>{t('Reload')}</button></main> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App/></ErrorBoundary></React.StrictMode>);
