import { t } from "../../trpcRuntime.ts";
import { createAuthProcedures } from "./base.ts";

const procedures = createAuthProcedures({ t });

export const protectedProcedure = procedures.protectedProcedure;
export const publicProcedure = procedures.publicProcedure;
