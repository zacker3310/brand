import { standardNavIcons } from '@mui/internal-core-docs/AppLayout';
import pagesApi from 'docs/data/material/pagesApi';
import { MuiPage } from '@mui/internal-core-docs/MuiPage';

const pages: MuiPage[] = [
  {
    pathname: '/material-ui/getting-started-group',
    title: 'Getting started',
    children: [
      { pathname: '/material-ui/getting-started', title: 'Overview' },
      { pathname: '/material-ui/getting-started/installation' },
      { pathname: '/material-ui/getting-started/usage' },
      { pathname: '/material-ui/getting-started/mcp', newFeature: true, title: 'MCP' },
      { pathname: '/material-ui/llms.txt', newFeature: true, title: 'llms.txt' },
      { pathname: '/material-ui/getting-started/example-projects' },
      { pathname: '/material-ui/getting-started/templates' },
      { pathname: '/material-ui/getting-started/learn' },
      { pathname: '/material-ui/getting-started/design-resources' },
      { pathname: '/material-ui/getting-started/faq', title: 'FAQs' },
      { pathname: '/material-ui/getting-started/accessibility' },
      { pathname: '/material-ui/getting-started/supported-components' },
      { pathname: '/material-ui/getting-started/supported-platforms' },
      { pathname: '/material-ui/getting-started/support' },
      { pathname: '/material-ui/getting-started/versions' },
    ],
  },
  {
    pathname: '/material-ui/react-',
    title: 'Components',
    children: [
      { pathname: '/material-ui/all-components', title: 'All components' },
      {
        pathname: '/material-ui/components/inputs',
        subheader: 'inputs',
        children: [
          { pathname: '/material-ui/react-autocomplete' },
          { pathname: '/material-ui/react-button' },
          { pathname: '/material-ui/react-button-group', title: 'Button Group' },
          { pathname: '/material-ui/react-checkbox' },
          {
            pathname: '/material-ui/react-floating-action-button',
            title: 'Floating Action Button',
          },
          { pathname: '/material-ui/react-number-field', title: 'Number Field', newFeature: true },
          { pathname: '/material-ui/react-radio-button', title: 'Radio Group' },
          { pathname: '/material-ui/react-rating' },
          { pathname: '/material-ui/react-select' },
          { pathname: '/material-ui/react-slider' },
          { pathname: '/material-ui/react-switch' },
          { pathname: '/material-ui/react-text-field', title: 'Text Field' },
          { pathname: '/material-ui/react-transfer-list', title: 'Transfer List' },
          { pathname: '/material-ui/react-toggle-button', title: 'Toggle Button' },
        ],
      },
      {
        pathname: '/material-ui/components/data-display',
        subheader: 'data-display',
        children: [
          { pathname: '/material-ui/react-avatar' },
          { pathname: '/material-ui/react-badge' },
          { pathname: '/material-ui/react-chip' },
          { pathname: '/material-ui/react-divider' },
          { pathname: '/material-ui/icons' },
          { pathname: '/material-ui/material-icons', title: 'Material Icons' },
          { pathname: '/material-ui/react-list' },
          { pathname: '/material-ui/react-table' },
          { pathname: '/material-ui/react-tooltip' },
          { pathname: '/material-ui/react-typography' },
        ],
      },
      {
        pathname: '/material-ui',
        subheader: 'lab',
        children: [
          { pathname: '/material-ui/about-the-lab', title: 'About the lab 🧪' },
          { pathname: '/material-ui/react-masonry' },
          { pathname: '/material-ui/react-timeline' },
        ],
      },
    ],
  },
  {
    title: 'Component API',
    pathname: '/material-ui/api',
    children: pagesApi,
  },
];

export default pages;
