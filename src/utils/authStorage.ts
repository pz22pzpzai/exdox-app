import * as SecureStore from 'expo-secure-store';

import { type AuthSession } from '../types';

const AUTH_SESSION_KEY = 'exdox-auth-session-v1';

export async function loadAuthSession() {
  const raw = await SecureStore.getItemAsync(AUTH_SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (
      !parsed ||
      typeof parsed.token !== 'string' ||
      !parsed.user ||
      typeof parsed.user.id !== 'number' ||
      typeof parsed.user.organisationId !== 'number' ||
      (parsed.user.role !== 'Business_Admin' && parsed.user.role !== 'Standard_Employee') ||
      (parsed.user.status !== 'active' && parsed.user.status !== 'pending_invite')
    ) {
      return null;
    }

    return parsed as AuthSession;
  } catch {
    return null;
  }
}

export async function saveAuthSession(session: AuthSession) {
  await SecureStore.setItemAsync(AUTH_SESSION_KEY, JSON.stringify(session));
}

export async function clearAuthSession() {
  await SecureStore.deleteItemAsync(AUTH_SESSION_KEY);
}
