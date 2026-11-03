import { customAlphabet } from 'nanoid'

const alnum = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12)
const short = customAlphabet('0123456789', 3)

export const newTransactionId = () => `txn_${alnum()}`
export const randomUserAccount = () => `acc_user_${short()}`
export const randomMerchantAccount = () => `acc_merchant_${short()}`

/** Random INR amount in rupees with 2 decimals, between 10 and 50,000. */
export const randomAmountInr = () => Math.round((10 + Math.random() * 49990) * 100) / 100

export function randomPayload() {
  return {
    transaction_id: newTransactionId(),
    source_account: randomUserAccount(),
    destination_account: randomMerchantAccount(),
    amount: randomAmountInr(),
    currency: 'INR',
  }
}
