import { createTRPCComponents } from "./trpc.ts";

const trpc = createTRPCComponents();

export const t = trpc.t;
export const createTRPCRouter = trpc.createTRPCRouter;
