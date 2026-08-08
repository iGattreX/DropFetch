import { writable } from 'svelte/store';
import type { ThemeMode } from '@shared/types';

export type { ThemeMode };

export interface AccentOption {
  id: string;
  label: string;
  /** Shade used on light backgrounds. */
  light: string;
  /** Brighter shade used on dark backgrounds. */
  dark: string;
}

export const accentOptions: AccentOption[] = [
  { id: 'teal', label: 'Teal', light: '#0f766e', dark: '#2dd4bf' },
  { id: 'blue', label: 'Blue', light: '#2563eb', dark: '#60a5fa' },
  { id: 'violet', label: 'Violet', light: '#7c3aed', dark: '#a78bfa' },
  { id: 'rose', label: 'Rose', light: '#e11d48', dark: '#fb7185' },
  { id: 'amber', label: 'Amber', light: '#b45309', dark: '#fbbf24' },
  { id: 'green', label: 'Green', light: '#15803d', dark: '#4ade80' },
];

// The source of truth is the settings DB (synced from /api/status at startup
// and saved via PUT /api/settings on change). localStorage is only a local
// cache so the correct theme paints before the API answers — see the inline
// script in index.html.
function storedMode(): ThemeMode {
  const v = localStorage.getItem('df-theme');
  return v === 'light' || v === 'dark' ? v : 'system';
}

export const themeMode = writable<ThemeMode>(storedMode());
export const accentId = writable<string>(localStorage.getItem('df-accent') ?? 'teal');

const media = window.matchMedia('(prefers-color-scheme: dark)');

let currentMode: ThemeMode = 'system';
let currentAccent = 'teal';

function apply(): void {
  const dark = currentMode === 'dark' || (currentMode === 'system' && media.matches);
  const accent = accentOptions.find((a) => a.id === currentAccent) ?? accentOptions[0];
  const color = dark ? accent.dark : accent.light;

  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--accent', color);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}

// Subscriptions fire immediately on import, so the theme is applied at startup.
themeMode.subscribe((mode) => {
  currentMode = mode;
  localStorage.setItem('df-theme', mode);
  apply();
});

accentId.subscribe((id) => {
  currentAccent = id;
  localStorage.setItem('df-accent', id);
  apply();
});

// Follow OS-level scheme changes while in "system" mode.
media.addEventListener('change', apply);
