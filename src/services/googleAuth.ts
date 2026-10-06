import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import type { AuthSession, WorkspaceCountry } from '../types';
import { getApiBaseUrl } from './auth';
import { setSessionToken } from './session';

type GoogleResult =
  | { kind: 'confirmed'; session: AuthSession }
  | { kind: 'two_factor'; idToken: string; emailEnabled: boolean; authenticatorEnabled: boolean; message: string };

let configuredClientId: string | null = null;

async function configureGoogle() {
  const response = await fetch(`${getApiBaseUrl()}/auth/google`);
  if (!response.ok) throw new Error('Google sign-in is not available yet.');
  const payload = await response.json() as { clientId?: string | null };
  if (!payload.clientId) throw new Error('Google sign-in is not configured yet.');
  if (configuredClientId !== payload.clientId) {
    GoogleSignin.configure({ webClientId: payload.clientId, offlineAccess: false });
    configuredClientId = payload.clientId;
  }
}

export async function chooseGoogleAccount(): Promise<string | null> {
  await configureGoogle();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) return null;
  const idToken = response.data.idToken;
  if (!idToken) throw new Error('Google did not return a sign-in token. Try again.');
  return idToken;
}

export async function authenticateWithGoogle(input: {
  idToken: string;
  mode: 'login' | 'register';
  accountType?: 'owner' | 'sole_trader';
  organisationName?: string;
  country?: WorkspaceCountry;
  termsAccepted?: boolean;
  twoFactorCode?: string;
  twoFactorMethod?: 'email' | 'authenticator' | 'recovery';
}): Promise<GoogleResult> {
  const response = await fetch(`${getApiBaseUrl()}/auth/google`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const payload = await response.json() as {
    success: boolean; message?: string; token?: string; user?: AuthSession['user'];
    requiresTwoFactor?: boolean; emailEnabled?: boolean; authenticatorEnabled?: boolean;
  };
  if (!response.ok || !payload.success) throw new Error(payload.message || 'Google sign-in failed.');
  if (payload.requiresTwoFactor) return {
    kind: 'two_factor', idToken: input.idToken,
    emailEnabled: Boolean(payload.emailEnabled), authenticatorEnabled: Boolean(payload.authenticatorEnabled),
    message: payload.message || 'Enter your Exdox verification code.',
  };
  if (!payload.token || !payload.user) throw new Error('Google sign-in did not return an Exdox session.');
  const session = { token: payload.token, user: payload.user };
  setSessionToken(session.token);
  return { kind: 'confirmed', session };
}
