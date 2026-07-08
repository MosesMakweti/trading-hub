import { z } from "zod";

export const accountStatusSchema = z.enum(["ACTIVE", "PASSED", "FAILED", "SUSPENDED", "CLOSED"]);
export const propFirmPhaseSchema = z.enum(["PHASE_1", "PHASE_2", "MASTER"]);

const optionalNote = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v ? v : undefined));

export const propFirmAccountSchema = z.object({
  name: z.string().trim().min(1, "Account name is required.").max(80),
  propFirmName: z.string().trim().min(1, "Prop firm is required.").max(80),
  accountSize: z.coerce.number().min(0),
  currentBalance: z.coerce.number().min(0),
  phase: propFirmPhaseSchema,
  purchaseCost: z.coerce.number().min(0),
  totalPayouts: z.coerce.number().min(0),
  status: accountStatusSchema,
  notes: optionalNote,
});

export const brokerageAccountSchema = z.object({
  name: z.string().trim().min(1, "Account name is required.").max(80),
  brokerName: z.string().trim().min(1, "Broker is required.").max(80),
  startingBalance: z.coerce.number().min(0),
  currentBalance: z.coerce.number().min(0),
  totalWithdrawals: z.coerce.number().min(0),
  totalDeposits: z.coerce.number().min(0),
  status: accountStatusSchema,
  notes: optionalNote,
});

// `z.coerce.number()` has a wider input type (`unknown`) than output type
// (`number`) — react-hook-form's `useForm` generic must be the input type
// (what the form fields actually hold) while the resolved submit handler
// receives the output type.
export type PropFirmAccountInput = z.infer<typeof propFirmAccountSchema>;
export type PropFirmAccountFormValues = z.input<typeof propFirmAccountSchema>;
export type BrokerageAccountInput = z.infer<typeof brokerageAccountSchema>;
export type BrokerageAccountFormValues = z.input<typeof brokerageAccountSchema>;
