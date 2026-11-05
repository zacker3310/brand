import { statusSharedColors } from "../global/colorPalette.js";
import { statusSharedColorNames } from "../sharedColorNames.js";
const statusColorPaletteTokens = statusSharedColorNames.reduce((acc, sharedColor)=>{
    const color = sharedColor.slice(0, 1).toUpperCase() + sharedColor.slice(1);
    const sharedColorTokens = {
        [`colorPalette${color}Background1`]: statusSharedColors[sharedColor].tint60,
        [`colorPalette${color}Foreground1`]: statusSharedColors[sharedColor].shade10
    };
    return Object.assign(acc, sharedColorTokens);
}, {});
// one-off patch for red
statusColorPaletteTokens.colorPaletteRedForegroundInverted = statusSharedColors.red.tint20;
export const colorPaletteTokens = {
    ...statusColorPaletteTokens
};
