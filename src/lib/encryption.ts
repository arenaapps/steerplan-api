import { supabase } from './supabase.js';
import { config } from '../config.js';

export const encryptPayload = async (payload: unknown): Promise<string> => {
  const key = config.supabase.encryptionKey;
  const { data, error } = await supabase.rpc('encrypt_payload', { payload, key });
  if (error) throw new Error(error.message);
  return data as string;
};

export const decryptPayload = async <T>(payloadEnc: string | null): Promise<T | null> => {
  if (!payloadEnc) return null;
  const key = config.supabase.encryptionKey;
  try {
    const { data, error } = await supabase.rpc('decrypt_payload', { payload: payloadEnc, key });
    if (error) throw new Error(error.message);
    return data as T;
  } catch {
    return null;
  }
};
