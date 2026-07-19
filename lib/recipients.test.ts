import { describe, expect, it } from 'vitest'
import { mergeAlertRecipients, type AlertRecipient } from './recipients'

const legacy = (email: string): AlertRecipient => ({
  email,
  token: `legacy:${email}`,
  interests: null,
  frequency: 'weekly',
  emailEnabled: true,
})

describe('mergeAlertRecipients', () => {
  it('keeps legacy-only subscribers when account recipients exist', () => {
    const account: AlertRecipient = {
      email: 'account@example.com',
      token: 'u:1',
      interests: ['markets'],
      frequency: 'weekly',
      emailEnabled: true,
    }

    expect(mergeAlertRecipients([account], [legacy('legacy@example.com')]))
      .toEqual([legacy('legacy@example.com'), account])
  })

  it('deduplicates case-insensitively and prefers explicit account settings', () => {
    const account: AlertRecipient = {
      email: 'Person@example.com',
      token: 'u:2',
      interests: ['labor'],
      frequency: 'breaking',
      emailEnabled: true,
    }

    expect(mergeAlertRecipients([account], [legacy('person@EXAMPLE.com')]))
      .toEqual([account])
  })
})
