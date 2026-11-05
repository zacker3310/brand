import { gray, blackAlpha, azure, green, yellow, orange, red, blue, purple, rose, magenta, lime, teal } from '../../colors.mjs';

var color = {
  'color-scheme': {
    value: 'light'
  },
  'color-bg': {
    value: gray[6],
    description: 'The default background color of the admin\'s pages.'
  },
  'color-bg-surface': {
    value: gray[1],
    description: 'The background color for elements with the highest level of prominence, like a card.'
  },
  'color-text': {
    value: gray[15],
    description: 'The default text color.'
  }
};

export { color };
