import type { Preview } from '@storybook/react-vite';
import '@navikt/ds-css';
import { Theme } from '@navikt/ds-react';
import React from 'react';
import { MemoryRouter } from 'react-router';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      disable: true,
    },
  },
  globalTypes: {
    theme: {
      description: 'Global theme for components',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: ['light', 'dark'],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
  },
  decorators: [
    (Story, context) => {
      // Skip MemoryRouter if story provides its own (uses parameters.router.skip)
      const skipRouter = context.parameters?.router?.skip;

      const content = (
        <Theme theme={context.globals.theme}>
          <div style={{ padding: '1rem' }}>
            <Story />
          </div>
        </Theme>
      );

      if (skipRouter) {
        return content;
      }

      return <MemoryRouter>{content}</MemoryRouter>;
    },
  ],
};

export default preview;