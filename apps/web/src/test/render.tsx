import { createTheme, MantineProvider, Modal } from '@mantine/core';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

const theme = createTheme({
  components: {
    Modal: Modal.extend({ defaultProps: { transitionProps: { duration: 0 } } }),
  },
});

function Providers({ children }: { children: ReactNode }) {
  return <MantineProvider theme={theme}>{children}</MantineProvider>;
}

export function renderWithMantine(ui: ReactElement) {
  return render(ui, { wrapper: Providers });
}
