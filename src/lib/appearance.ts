import { brandPurple, mixColor } from './brand'
export const accentThemes = [
  {
    id: 'cottage',
    name: 'Cottage Purple',
    primary: brandPurple,
    accent: mixColor(brandPurple, '#ffffff', 0.91),
    dark: mixColor(brandPurple, '#ffffff', 0.72),
    background: '#f5f6fa',
  },
  {
    id: 'plum',
    name: 'Plum Pantry',
    primary: '#742b60',
    accent: '#eedff0',
    dark: '#edb7df',
    background: '#f5f6fa',
  },
  {
    id: 'orchard',
    name: 'Orchard Green',
    primary: '#20583f',
    accent: '#deebdf',
    dark: '#9bddb6',
    background: '#f5f6fa',
  },
  {
    id: 'berry',
    name: 'Berry Market',
    primary: '#a02956',
    accent: '#f8e0e8',
    dark: '#ffb0cb',
    background: '#f5f6fa',
  },
  {
    id: 'blueberry',
    name: 'Blueberry',
    primary: '#344dba',
    accent: '#e3e8fd',
    dark: '#bcc9ff',
    background: '#f5f6fa',
  },
  {
    id: 'terracotta',
    name: 'Terracotta Kitchen',
    primary: '#99452f',
    accent: '#f6e8e8',
    dark: '#f4bc9e',
    background: '#f5f6fa',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    primary: '#353e7e',
    accent: '#e6e3f6',
    dark: '#c4baff',
    background: '#f5f6fa',
  },
  {
    id: 'ink',
    name: 'Neutral Ink',
    primary: '#343b43',
    accent: '#e5e9ed',
    dark: '#ccd4df',
    background: '#f5f6fa',
  },
] as const
export type Appearance = {
  theme: (typeof accentThemes)[number]['id']
  mode: 'light' | 'dark' | 'system'
}
export const defaultAppearance: Appearance = { theme: 'cottage', mode: 'light' }
export function validateAppearance(value: unknown): Appearance {
  const a = value as Appearance
  if (
    !a ||
    !accentThemes.some((t) => t.id === a.theme) ||
    !['light', 'dark', 'system'].includes(a.mode)
  )
    throw new Error('Choose a supported theme and display mode.')
  return { theme: a.theme, mode: a.mode }
}
export function appearanceVariables(
  value: Appearance,
  systemDark = false,
): Record<string, string> {
  const t = accentThemes.find((t) => t.id === value.theme) || accentThemes[0]
  const dark = value.mode === 'dark' || (value.mode === 'system' && systemDark)
  return {
    '--brand-purple': brandPurple,
    '--primary': dark ? t.dark : t.primary,
    '--primary-hover': mixColor(
      dark ? t.dark : t.primary,
      dark ? '#ffffff' : '#000000',
      0.16,
    ),
    '--primary-pressed': mixColor(
      dark ? t.dark : t.primary,
      dark ? '#ffffff' : '#000000',
      0.25,
    ),
    '--accent-border': mixColor(
      t.primary,
      dark ? '#22252c' : '#ffffff',
      dark ? 0.28 : 0.75,
    ),
    '--focus-ring': dark ? t.dark : t.primary,
    '--primary-ink': dark ? '#211b24' : '#ffffff',
    '--accent-soft': dark ? mixColor(t.primary, '#22252c', 0.78) : t.accent,
    '--background': dark ? '#17191e' : t.background,
    '--foreground': dark ? '#f2f1f6' : '#242734',
    '--card': dark ? '#22252c' : '#ffffff',
    '--surface-soft': dark ? '#2b2e36' : '#f0f2f7',
    '--border': dark ? '#424650' : '#e1e5ed',
    '--muted': dark ? '#b9bdc9' : '#606879',
    '--success': dark ? '#a4e7bd' : '#226342',
    '--success-bg': dark ? '#203e31' : '#edf6f2',
    '--warning': dark ? '#ffdc95' : t.id === 'berry' ? '#855017' : '#805309',
    '--warning-bg': dark ? '#30343e' : '#f0f2f7',
    '--danger': dark ? '#ffb9c3' : '#a02b43',
    '--danger-bg': dark ? '#482b34' : '#fbe4e9',
    '--info': dark ? '#b4d6ff' : '#27589e',
    '--info-bg': dark ? '#26364e' : '#e6eefb',
    '--sage': dark ? mixColor(t.primary, '#22252c', 0.78) : t.accent,
    '--plum': dark ? t.dark : t.primary,
  }
}

// Appearance is a non-sensitive startup hint; business records stay server-side.
export const appearanceCacheKey = 'cottage-pantry.appearance.v1'
export function resolveAppearance(
  value: unknown,
  fallback = defaultAppearance,
): Appearance {
  try {
    return validateAppearance(value)
  } catch {
    return fallback
  }
}
export function readAppearanceCache(): Appearance {
  try {
    return resolveAppearance(
      JSON.parse(localStorage.getItem(appearanceCacheKey) || 'null'),
    )
  } catch {
    return defaultAppearance
  }
}
export function cacheAppearance(value: Appearance) {
  try {
    localStorage.setItem(
      appearanceCacheKey,
      JSON.stringify(validateAppearance(value)),
    )
  } catch {
    /* Storage can be blocked. */
  }
}
export function applyAppearance(value: Appearance, systemDark = false) {
  const root = document.documentElement
  for (const [key, val] of Object.entries(
    appearanceVariables(value, systemDark),
  ))
    root.style.setProperty(key, val)
  const dark = value.mode === 'dark' || (value.mode === 'system' && systemDark)
  root.dataset.mode = dark ? 'dark' : 'light'
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
}
// A blocking head script uses the same generated palettes as the mounted app.
export function appearanceBootScript() {
  const palettes = Object.fromEntries(
    accentThemes.map((t) => [
      t.id,
      {
        light: appearanceVariables({ theme: t.id, mode: 'light' }),
        dark: appearanceVariables({ theme: t.id, mode: 'dark' }),
      },
    ]),
  )
  return `(()=>{var palettes=${JSON.stringify(palettes)},a=${JSON.stringify(defaultAppearance)};try{var saved=JSON.parse(localStorage.getItem('${appearanceCacheKey}')||'null');if(saved&&Object.hasOwn(palettes,saved.theme)&&['light','dark','system'].includes(saved.mode))a=saved}catch{}var dark=a.mode==='dark'||(a.mode==='system'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches),r=document.documentElement;Object.entries(palettes[a.theme][dark?'dark':'light']).forEach(([k,v])=>r.style.setProperty(k,v));r.dataset.mode=dark?'dark':'light';r.classList.toggle('dark',!!dark);r.style.colorScheme=dark?'dark':'light'})()`
}
