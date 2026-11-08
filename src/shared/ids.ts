import { randomUUID } from 'node:crypto';

/** Short unique identifier with a readable prefix, e.g. `task_3f9a1c0b7d2e4a55`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** Lowercase, dash-separated, filesystem-safe slug limited to `max` characters. */
export function slugify(text: string, max = 48): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'task';
}
