export const defaultPresetColors = {
  blue: '#1677FF',
  /**
   * @deprecated Use magenta instead
   */
  pink: '#EB2F96'
};
const seedToken = {
  // preset color palettes
  ...defaultPresetColors,
  colorPrimary: '#1677ff',
  colorTextBase: '',
  fontFamily: `-apple-system, BlinkMacSystemFont,
'Noto Sans', sans-serif`,
  fontSize: 14,
  motionUnit: 0.1,
  motionEaseInBack: 'cubic-bezier(0.71, -0.46, 0.88, 0.6)',
  wireframe: false,
  motion: true
};
export default seedToken;
