/**
 * Payments seam (stub). A real gateway would implement the same one-method
 * interface; nothing outside this file knows payments are stubbed.
 */

export interface CaptureInput {
  orderId: number;
  /** Total the patient is being charged, in integer cents. */
  amountCents: number;
  /**
   * Deterministic test control: forces the stub to decline. Exists so the
   * decline-then-retry path is exercisable without a real card.
   */
  forceDecline?: boolean;
}

export type CaptureOutput =
  | { status: "succeeded"; gatewayRef: string }
  | { status: "declined"; reason: string };

export interface PaymentGateway {
  capture(input: CaptureInput): Promise<CaptureOutput>;
}

/**
 * SHORTCUT / STUB: no real charge, no network, no card data. Ceiling: returns
 * succeeded unless forceDecline is set; a real gateway would add authorization,
 * 3DS, and asynchronous settlement — out of scope by design.
 */
export class StubPaymentGateway implements PaymentGateway {
  async capture(input: CaptureInput): Promise<CaptureOutput> {
    if (input.forceDecline) {
      return { status: "declined", reason: "card_declined (forced by test control)" };
    }
    return { status: "succeeded", gatewayRef: `stub_capture_${input.orderId}` };
  }
}
