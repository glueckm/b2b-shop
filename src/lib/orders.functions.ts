import { createServerFn } from "@tanstack/react-start";

import type { CustomerOrder } from "./orders.server";

/** Aufträge des angemeldeten Kunden (Kundennummer aus dem geprüften Login). */
export const getMyOrders = createServerFn({ method: "GET" }).handler(
  async (): Promise<CustomerOrder[] | null> => {
    const { apiCurrentUser } = await import("./shop-auth.server");
    const user = await apiCurrentUser();
    if (!user?.customerNumber) return null;
    const { withDbSession } = await import("./db.server");
    const { customerOrders } = await import("./orders.server");
    return withDbSession((s) => customerOrders(user.customerNumber!, s.query));
  },
);
