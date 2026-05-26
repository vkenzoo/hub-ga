import { decrypt } from "@/lib/crypto";

export interface EncryptedConn {
  access_token_ciphertext: string;
  app_secret_ciphertext: string;
}

export interface MetaCredentials {
  token: string;
  appSecret: string;
}

/**
 * Decifra credenciais de uma row de meta_connections.
 * Use no servidor antes de chamar graphGet/graphPost.
 */
export function decryptCredentials(conn: EncryptedConn): MetaCredentials {
  return {
    token: decrypt(conn.access_token_ciphertext),
    appSecret: decrypt(conn.app_secret_ciphertext),
  };
}
