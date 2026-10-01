import { AppState } from '../types';

export const seedState: AppState = {
  documents: [],
  receiptDecisions: [],
  claims: [],
  vehicles: [],
  settings: {
    openOnCamera: true,
    lowResolution: false,
    saveToGallery: true,
    inAppSounds: false,
    marketingNotifications: false,
    theme: 'system',
  },
  organisationSettings: null,
};
