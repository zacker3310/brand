export default function extendTheme(themeOptions) {
  const defaultColors = {
    primary: colors.blue,
    neutral: colors.grey,
    danger: colors.red,
    success: colors.green,
    warning: colors.yellow,
    common: {
      white: '#FFF',
      black: '#000'
    }
  };
  const fontFamilyFallback = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"';
  const fontFamily = _extends({
    body: `"Inter", ${getCssVar(`fontFamily-fallback, ${fontFamilyFallback}`)}`,
    display: `"Inter", ${getCssVar(`fontFamily-fallback, ${fontFamilyFallback}`)}`,
    code: 'Source Code Pro,ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace',
    fallback: fontFamilyFallback
  }, scalesInput.fontFamily);
  const fontWeight = _extends({
    sm: 300,
    // regular
    md: 500,
    // medium
    lg: 600,
    // semi-bold
    xl: 700
  }, scalesInput.fontWeight);
  const fontSize = _extends({
    xs: '0.75rem',
    // 12px
    sm: '0.875rem',
    // 14px
    md: '1rem',
    // 16px
    lg: '1.125rem',
    // 18px
    xl: '1.25rem',
    // 20px
    xl2: '1.5rem',
    // 24px
    xl3: '1.875rem',
    // 30px
    xl4: '2.25rem'
  }, scalesInput.fontSize);
  const lineHeight = _extends({
    xs: '1.33334',
    // largest font sizes: h1, h2
    sm: '1.42858',
    // normal font sizes
    md: '1.5',
    // normal font sizes
    lg: '1.55556',
    // large font sizes for components
    xl: '1.66667'
  }, scalesInput.lineHeight);
  const defaultScales = {
    colorSchemes: {
      light: lightColorSystem,
      dark: darkColorSystem
    },
    fontSize,
    fontFamily,
    fontWeight,
    focus: {
      thickness: '2px',
      selector: `&.${generateUtilityClass('', 'focusVisible')}, &:focus-visible`,
      default: {
        outlineOffset: `var(--focus-outline-offset, ${getCssVar('focus-thickness', (_scalesInput$focus$th = (_scalesInput$focus = scalesInput.focus) == null ? void 0 : _scalesInput$focus.thickness) != null ? _scalesInput$focus$th : '2px')})`,
        outline: `${getCssVar('focus-thickness', (_scalesInput$focus$th2 = (_scalesInput$focus2 = scalesInput.focus) == null ? void 0 : _scalesInput$focus2.thickness) != null ? _scalesInput$focus$th2 : '2px')} solid ${getCssVar('palette-focusVisible', defaultColors.primary[500])}`
      }
    },
    radius: {
      xs: '2px',
      sm: '6px',
      md: '8px',
      lg: '12px',
      xl: '16px'
    },
    shadow: {
      xs: `${getCssVar('shadowRing', defaultShadowRing)}, 0px 1px 2px 0px rgba(${getCssVar('shadowChannel', defaultShadowChannel)} / ${getCssVar('shadowOpacity', defaultShadowOpacity)})`,
      sm: `${getCssVar('shadowRing', defaultShadowRing)}, 0px 1px 2px 0px rgba(${getCssVar('shadowChannel', defaultShadowChannel)} / ${getCssVar('shadowOpacity', defaultShadowOpacity)}), 0px 2px 4px 0px rgba(${getCssVar('shadowChannel', defaultShadowChannel)} / ${getCssVar('shadowOpacity', defaultShadowOpacity)})`,
      md: `${getCssVar('shadowRing', defaultShadowRing)}, 0px 2px 8px -2px rgba(${getCssVar('shadowChannel', defaultShadowChannel)} / ${getCssVar('shadowOpacity', defaultShadowOpacity)}), 0px 6px 12px -2px rgba(${getCssVar('shadowChannel', defaultShadowChannel)} / ${getCssVar('shadowOpacity', defaultShadowOpacity)})`,
      lg: `${getCssVar('shadowRing', defaultShadowRing)}, 0px 2px 8px -2px rgba(${getCssVar('shadowChannel', defaultShadowChannel)} / ${getCssVar('shadowOpacity', defaultShadowOpacity)}), 0px 12px 16px -4px rgba(${getCssVar('shadowChannel', defaultShadowChannel)} / ${getCssVar('shadowOpacity', defaultShadowOpacity)})`,
      xl: `${getCssVar('shadowRing', defaultShadowRing)}, 0px 2px 8px -2px rgba(${getCssVar('shadowChannel', defaultShadowChannel)} / ${getCssVar('shadowOpacity', defaultShadowOpacity)}), 0px 20px 24px -4px rgba(${getCssVar('shadowChannel', defaultShadowChannel)} / ${getCssVar('shadowOpacity', defaultShadowOpacity)})`
    },
    zIndex: {
      badge: 1,
      table: 10,
      popup: 1000,
      modal: 1300,
      snackbar: 1400,
      tooltip: 1500
    },
  };
  return defaultScales;
}
