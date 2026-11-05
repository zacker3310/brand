/**
 * Programmatically generates a tokens to css variables mapping object from the keys in a theme.
 */ export function themeToTokensObject(theme) {
    const tokens = {};
    const keys = Object.keys(theme);
    for (const key of keys){
        tokens[key] = `var(--${String(key)})`;
    }
    return tokens;
}
