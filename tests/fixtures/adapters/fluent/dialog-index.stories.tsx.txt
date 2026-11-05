import { Dialog, DialogSurface, DialogTitle, DialogActions, DialogTrigger } from '@fluentui/react-components';

import descriptionMd from './DialogDescription.md';
import bestPracticesMd from './DialogBestPractices.md';
import a11yMd from './DialogA11y.md';
import ssrMd from './DialogSSR.md';

export { Default } from './DialogDefault.stories';
export { NonModal } from './DialogNonModal.stories';
export { Alert } from './DialogAlert.stories';

// Typing with Meta<typeof Dialog> generates a type error for the `subcomponents` property.
// https://github.com/storybookjs/storybook/issues/27535
//
// TODO: bring back typing when the issue is resolved
const metadata = {
  title: 'Components/Dialog',
  component: Dialog,
  subcomponents: {
    DialogTrigger,
    DialogSurface,
    DialogTitle,
    DialogActions,
  },
  parameters: {
    docs: {
      description: {
        component: [descriptionMd, bestPracticesMd, a11yMd, ssrMd].join('\n'),
      },
    },
  },
};

export default metadata;

