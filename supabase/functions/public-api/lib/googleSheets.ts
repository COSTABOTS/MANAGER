import { toStringValue } from './normalization.ts';

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, '\n');
}

function stringToBytes(value: string) {
  return new TextEncoder().encode(value);
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem: string) {
  const base64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

export async function createGoogleAccessToken() {
  const serviceAccountJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');

  if (!serviceAccountJson) {
    throw new Error('GOOGLE_SECRET_MISSING');
  }

  const serviceAccount = JSON.parse(serviceAccountJson) as {
    client_email?: string;
    private_key?: string;
  };

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('GOOGLE_SECRET_INVALID');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsignedJwt = `${base64UrlEncode(stringToBytes(JSON.stringify(header)))}.${base64UrlEncode(stringToBytes(JSON.stringify(claim)))}`;
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(normalizePrivateKey(serviceAccount.private_key)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, stringToBytes(unsignedJwt));
  const jwt = `${unsignedJwt}.${base64UrlEncode(new Uint8Array(signature))}`;
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    throw new Error(`GOOGLE_AUTH_ERROR: ${tokenResponse.status}: ${errorBody}`);
  }

  const tokenData = await tokenResponse.json() as { access_token?: string };
  if (!tokenData.access_token) {
    throw new Error('GOOGLE_AUTH_ERROR: access_token missing');
  }

  return tokenData.access_token;
}

export async function fetchSheetValues(sheetId: string, range: string, accessToken: string) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${response.status}: ${errorBody}`);
  }

  return response.json() as Promise<{ values?: unknown[][] }>;
}

export async function updateSheetCell(sheetId: string, range: string, value: string, accessToken: string) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [[value]] }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GOOGLE_SHEETS_ERROR: ${response.status}: ${errorBody}`);
  }
}

export async function appendSheetValues(sheetId: string, range: string, values: unknown[][], accessToken: string) {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    },
  );

  if (!response.ok) {
    throw new Error(`GOOGLE_SHEETS_ERROR: ${response.status}`);
  }
}

export function getSheetIdForLog(sheetId: string) {
  const value = toStringValue(sheetId);
  return value ? `${value.slice(0, 4)}...${value.slice(-4)}` : '';
}
