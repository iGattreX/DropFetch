import 'dotenv/config';
import path from 'node:path';

// Compiled: <root>/dist/src/config.js  → root is two levels up.
// Via tsx:  <root>/src/config.ts       → root is one level up.
const parent = path.resolve(__dirname, '..');
const root = path.basename(parent) === 'dist' ? path.resolve(parent, '..') : parent;

export const config = {
  root,
  port: Number(process.env.PORT ?? 8090),
  apiId: Number(process.env.TELEGRAM_API_ID ?? 0),
  apiHash: process.env.TELEGRAM_API_HASH ?? '',
  dataDir: path.resolve(root, process.env.DATA_DIR ?? 'data'),
  defaultDownloadDir: path.resolve(root, 'downloads'),
  webDist: path.resolve(root, 'web', 'dist'),
};

export function hasCredentials(): boolean {
  return config.apiId > 0 && config.apiHash.length > 0;
}
