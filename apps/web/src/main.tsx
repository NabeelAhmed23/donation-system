import '@mantine/core/styles.css';

import { MantineProvider, Title } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}

createRoot(root).render(
  <StrictMode>
    <MantineProvider>
      <main>
        <Title order={1}>Donation System</Title>
      </main>
    </MantineProvider>
  </StrictMode>,
);
