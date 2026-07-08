import { AppState } from '../types';

export const seedState: AppState = {
  documents: [],
  claims: [],
  settings: {
    openOnCamera: true,
    lowResolution: false,
    saveToGallery: true,
    inAppSounds: false,
    marketingNotifications: false,
    theme: 'system',
  },
};
