import seedToken from '../themes/seed';
export default function formatToken(derivativeToken) {
  const mergedToken = { ...derivativeToken };
  const screenXS = 480;
  const screenSM = 576;
  const aliasToken = {
    ...mergedToken,
    // ============== Text ============== //
    colorTextHeading: mergedToken.colorText,
    colorTextLabel: mergedToken.colorTextSecondary,
    fontHeight: Math.round(mergedToken.fontSize * mergedToken.lineHeight),
    fontWeightStrong: 600,
    linkDecoration: 'none',
    boxShadow: `
      0 6px 16px 0 ${getShadowColor(0.08)}
    `,
    screenXS,
    screenXSMin: screenXS,
    screenXSMax: screenSM - 1,
    screenSM,
    ...overrideTokens
  };
  return aliasToken;
}
