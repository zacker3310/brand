import { unit } from '@ant-design/cssinjs';
export const prepareToken = token => {
  const { paddingInline } = token;
  return mergeToken(token, { buttonPaddingHorizontal: paddingInline });
};
export const prepareComponentToken = token => {
  const contentFontSize = token.contentFontSize ?? token.fontSize;
  const defaultBgDisabled = token.colorBgContainerDisabled;
  return {
    fontWeight: 400,
    defaultShadow: `0 ${token.controlOutlineWidth}px 0 ${token.controlTmpOutline}`,
    paddingInline: token.paddingContentHorizontal - token.lineWidth,
    textTextColor: token.colorText,
    defaultColor: token.colorText,
    defaultBg: token.colorBgContainer,
    defaultBgDisabled,
    contentFontSize
  };
};
