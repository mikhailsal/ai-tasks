import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initializeCache } from '../data/cache.js';
import { CACHE_GC_TIME } from '../data/cache-storage.js';
import { registerShell } from '../data/shell.js';
import { App } from './App.js';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { gcTime: CACHE_GC_TIME, networkMode: 'always', retry: false },
    mutations: { retry: false, networkMode: 'always' },
  },
});
async function mount() {
  await initializeCache(queryClient);
  const root = document.getElementById('root');
  if (!root) throw new Error('Application root is missing');
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
  void registerShell();
}
void mount();
