import { z } from "zod";

// Estrutura aproximada do webhook v2 do Hotmart. Permissivo na v1.
export const hotmartEventSchema = z
  .object({
    id: z.string().min(1),
    event: z.string().min(1),
    data: z
      .object({
        product: z
          .object({
            id: z.union([z.string(), z.number()]).transform(String),
            name: z.string().optional(),
          })
          .passthrough(),
        buyer: z
          .object({
            email: z.string().email(),
            name: z.string().optional(),
            phone: z.string().optional(),
          })
          .passthrough(),
        purchase: z
          .object({
            transaction: z.string().optional(),
            status: z.string().optional(),
            price: z
              .object({
                value: z.union([z.string(), z.number()]).transform((v) => Number(v)),
              })
              .passthrough()
              .optional(),
            payment: z
              .object({
                type: z.string().optional(),
                method: z.string().optional(),
              })
              .passthrough()
              .optional(),
            tracking: z
              .object({
                source: z.string().optional(),
                source_sck: z.string().optional(),
                external_code: z.string().optional(),
              })
              .partial()
              .optional(),
          })
          .passthrough()
          .optional(),
        affiliates: z
          .array(
            z
              .object({
                affiliate_code: z.string().optional(),
                name: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
        subscription: z
          .object({
            subscriber: z.object({ code: z.string().optional() }).passthrough().optional(),
            status: z.string().optional(),
            date_next_charge: z.union([z.string(), z.number()]).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type HotmartEvent = z.infer<typeof hotmartEventSchema>;
