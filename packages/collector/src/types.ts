export type InvoiceRecord = {
  occurredAt: string;
  amountCents: number;
  currency: string;
  description: string;
  invoiceNumber?: string;
  invoiceUrl?: string;
};
