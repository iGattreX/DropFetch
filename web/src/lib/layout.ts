import { writable } from 'svelte/store';
import type { LayoutMode, SectionId } from '@shared/types';

export type { LayoutMode, SectionId };

export const SECTION_ORDER: SectionId[] = ['files', 'channels', 'keywords'];

export const SECTION_LABELS: Record<SectionId, string> = {
  files: 'Files',
  channels: 'Channels',
  keywords: 'Keywords',
};

/**
 * Desktop layout preference — stored in the settings DB (synced from
 * /api/status at startup and pushed to all sessions on change). Mobile always
 * renders a single column regardless of these.
 */
export const layoutMode = writable<LayoutMode>('single');
export const layoutColumns = writable<SectionId[]>(['files', 'channels']);
