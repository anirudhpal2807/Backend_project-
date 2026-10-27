const REDACTED_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'refresh_token',
  'jwt_secret',
  'secret',
  'master_encryption_key',
  'authorization',
  'cookie',
  'totp_secret',
  'mfa_secret',
  'clinical_notes',
  'clinical_notes_encrypted',
  'items_encrypted',
  'instructions_encrypted',
  'phone_encrypted',
  'dob_encrypted',
  'credit_card',
  'cvv',
]);

export function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Check if it's a JSON string
    try {
      if (obj.startsWith('{') || obj.startsWith('[')) {
        const parsed = JSON.parse(obj);
        return JSON.stringify(redactSensitiveData(parsed));
      }
    } catch {
      // not json, return original string
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (
        REDACTED_KEYS.has(lowerKey) ||
        lowerKey.includes('secret') ||
        lowerKey.includes('password')
      ) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = redactSensitiveData(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return obj;
}
