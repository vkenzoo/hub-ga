import { z } from "zod";

// Schema permissivo na primeira versão. Os campos exigidos cobrem o mínimo
// para registrar uma venda. Quando recebermos webhooks reais, apertamos o schema.
export const assinyEventSchema = z
  .object({
    event_id: z.string().min(1),
    event_type: z.string().min(1),
    product: z
      .object({
        id: z.union([z.string(), z.number()]).transform(String),
        name: z.string().optional(),
      })
      .passthrough(),
    customer: z
      .object({
        email: z.string().email(),
        name: z.string().optional(),
        phone: z.string().optional(),
      })
      .passthrough(),
    amount: z.union([z.string(), z.number()]).transform((v) => Number(v)),
    status: z.string().optional(),
    subscription_id: z.string().optional(),
    current_period_end: z.string().optional(),
    utm: z
      .object({
        source: z.string().optional(),
        medium: z.string().optional(),
        campaign: z.string().optional(),
        content: z.string().optional(),
        term: z.string().optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

export type AssinyEvent = z.infer<typeof assinyEventSchema>;
