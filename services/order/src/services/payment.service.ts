/**
 * Payment Service — Mocked Payment Processor
 *
 * Simulates a payment gateway for development and testing.
 *
 * Behavior:
 * - Amounts < $10,000: Returns success with a mock paymentId
 * - Amounts >= $10,000: Returns failure (for testing error flows)
 * - Processing delay: 50–200ms (simulates network latency)
 */

import { randomUUID } from 'crypto';

export interface PaymentResult {
  success: boolean;
  paymentId: string | null;
  message: string;
  amount: number;
  processedAt: string;
}

/**
 * Process a mock payment.
 *
 * @param amount - The amount to charge (in dollars)
 * @param userId - The ID of the user being charged
 * @returns PaymentResult with success/failure status
 */
export async function processPayment(amount: number, userId: string): Promise<PaymentResult> {
  // Simulate network latency (50-200ms)
  const delay = Math.floor(Math.random() * 150) + 50;
  await new Promise((resolve) => setTimeout(resolve, delay));

  const processedAt = new Date().toISOString();

  // Simulate payment failure for large amounts (testing purposes)
  if (amount >= 10000) {
    console.log(`💳 Payment DECLINED for user ${userId}: $${amount.toFixed(2)} (exceeds limit)`);
    return {
      success: false,
      paymentId: null,
      message: 'Payment declined: Amount exceeds processing limit.',
      amount,
      processedAt,
    };
  }

  // Simulate successful payment
  const paymentId = `pay_${randomUUID().replace(/-/g, '').substring(0, 24)}`;

  console.log(`💳 Payment APPROVED for user ${userId}: $${amount.toFixed(2)} → ${paymentId}`);

  return {
    success: true,
    paymentId,
    message: 'Payment processed successfully.',
    amount,
    processedAt,
  };
}

/**
 * Process a mock refund.
 *
 * @param paymentId - The original payment ID to refund
 * @param amount - The amount to refund
 * @returns PaymentResult with refund status
 */
export async function processRefund(paymentId: string, amount: number): Promise<PaymentResult> {
  // Simulate network latency
  const delay = Math.floor(Math.random() * 100) + 50;
  await new Promise((resolve) => setTimeout(resolve, delay));

  const refundId = `ref_${randomUUID().replace(/-/g, '').substring(0, 24)}`;

  console.log(`💳 Refund PROCESSED: $${amount.toFixed(2)} for payment ${paymentId} → ${refundId}`);

  return {
    success: true,
    paymentId: refundId,
    message: `Refund processed for original payment ${paymentId}.`,
    amount,
    processedAt: new Date().toISOString(),
  };
}
