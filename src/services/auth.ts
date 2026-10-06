import { type AuthSession, type WorkspaceCountry } from '../types';
import { setSessionToken } from './session';

const API_BASE_URL =
  process.env.EXPO_PUBLIC_EXPENSES_API_URL?.trim()?.replace(/\/api\/v1\/expenses\/process$/, '') ||
  'https://hz2zkm6jkf.execute-api.eu-west-2.amazonaws.com/prod';

type AuthResponse =
  | {
      success: true;
      token: string;
      user: AuthSession['user'];
    }
  | {
      success: false;
      message?: string;
    };

export async function loginWithEmail(input: { email: string; password: string }) {
  return authenticate('/login', input);
}

export async function registerWithEmail(input: {
  accountType: 'owner' | 'sole_trader' | 'employee';
  country?: WorkspaceCountry;
  email: string;
  confirmEmail: string;
  password: string;
  confirmPassword: string;
  fullName?: string;
  organisationName?: string;
  termsAccepted?: true;
  termsVersion?: string;
}): Promise<{ kind: 'confirmed'; session: AuthSession } | { kind: 'pending_confirmation'; message: string; email: string }> {
  const response = await fetch(`${API_BASE_URL}/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const data = await response.json() as {
    success: boolean; message?: string; token?: string; user?: AuthSession['user'];
    requiresEmailConfirmation?: boolean;
  };
  if (!response.ok || !data.success) throw new Error(data.message || 'Registration failed.');
  if (data.token && data.user) {
    const session = { token: data.token, user: data.user };
    setSessionToken(session.token);
    return { kind: 'confirmed', session };
  }
  if (data.requiresEmailConfirmation) return {
    kind: 'pending_confirmation',
    message: data.message || 'Your trial has started. Check your email to confirm your account within three days.',
    email: data.user?.email || input.email.trim(),
  };
  throw new Error('Registration completed without an Exdox account response.');
}

export async function resendConfirmationEmail(email: string): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/confirm-email/resend`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  const data = await response.json() as { success: boolean; message?: string };
  if (!response.ok || !data.success) throw new Error(data.message || 'Could not resend the confirmation email.');
  return data.message || 'Confirmation email sent.';
}

async function authenticate(path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as AuthResponse;
  if (!response.ok || !data.success) {
    throw new Error(('message' in data && data.message) || 'Authentication failed.');
  }

  const session = {
    token: data.token,
    user: data.user,
  } satisfies AuthSession;
  setSessionToken(session.token);
  return session;
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}
