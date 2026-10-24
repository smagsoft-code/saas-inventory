/** `GET /api/v1/reports/payments` — `PaymentsReportResponseDto`. */
export interface PaymentReturnInfo {
  count: number;
  numbers: string[];
  returnedValue: number;
}

export interface PaymentRow {
  id: string;
  paidAt: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  paymentMethod: string;
  amount: number;
  sellerName?: string;
  locationId: string;
  /** "Sucursal · Almacén". */
  locationLabel: string;
  documentType: string;
  /** Present only when the order has at least one non-cancelled return. */
  returns?: PaymentReturnInfo;
}

export interface PaymentMethodTotal {
  paymentMethod: string;
  paymentCount: number;
  amount: number;
}

export interface PaymentsReport {
  timezone: string;
  currency: string;
  totals: { paymentCount: number; amount: number; byMethod: PaymentMethodTotal[] };
  data: PaymentRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export const PAYMENT_SORT_COLUMNS = ['createdAt', 'orderNumber', 'customer', 'seller', 'paymentMethod', 'amount', 'location', 'documentType'] as const;
export type PaymentSortColumn = (typeof PAYMENT_SORT_COLUMNS)[number];

/** Why a payment's amount is shown on red — shown as the cell's tooltip and in the page footnote. */
export const PAYMENT_RETURN_NOTE = 'Orden con devolución: el pago no se reversa; el monto es el cobrado originalmente.';
