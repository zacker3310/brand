import { colorPaletteTokens } from "../alias/lightColorPalette.js";
import { generateColorTokens } from "../alias/lightColor.js";
import { fontSizes, fontFamilies } from "../global/fonts.js";
import { createShadowTokens } from "./shadows.js";
export const createLightTheme = (brand)=>{
    const colorTokens = generateColorTokens(brand);
    return {
        ...fontSizes,
        ...fontFamilies,
        ...colorTokens,
        ...colorPaletteTokens,
        ...createShadowTokens(colorTokens.colorNeutralShadowAmbient, colorTokens.colorNeutralShadowKey)
    };
};
