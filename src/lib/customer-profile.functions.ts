import { createServerFn } from "@tanstack/react-start";

import { withDbSession } from "./db.server";
import { customerProfile, type CustomerProfile } from "./customer-profile.server";
import { readCustomerNumber } from "./shop-auth.server";

/** Stammdaten des angemeldeten Kunden (nur lesend). */
export const getCustomerProfile = createServerFn({ method: "GET" }).handler(
  async (): Promise<CustomerProfile | null> => {
    const number = readCustomerNumber();
    if (!number) return null;
    return await withDbSession((session) => customerProfile(number, session.query));
  },
);
