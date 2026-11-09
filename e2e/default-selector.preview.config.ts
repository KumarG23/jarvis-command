import { defineConfig } from 'vite';
import isolated from './thread-status.preview.config';
// Retain the accepted fixture-only 503 API fallback and zero proxy configuration.
export default defineConfig({ ...isolated, preview: { ...isolated.preview, port: 3127 } });
