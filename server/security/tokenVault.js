import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const VERSION = 'v1'
const keyFor = (secret) => createHash('sha256').update(secret).digest()

export const createTokenVault = ({ secret }) => {
  if (!secret || secret.length < 32) throw new Error('TOKEN_ENCRYPTION_KEY must be at least 32 characters')
  const key = keyFor(secret)
  return {
    encrypt: (value) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return { ciphertext: `${VERSION}.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`, keyVersion: VERSION }
    },
    decrypt: (payload) => {
      const value = typeof payload === 'string' ? payload : payload?.ciphertext
      const [version, ivText, tagText, ciphertextText] = String(value || '').split('.')
      if (version !== VERSION || !ivText || !tagText || !ciphertextText) throw new Error('Invalid encrypted token')
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'))
      decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
      return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8')
    },
  }
}