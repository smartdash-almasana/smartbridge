import { redirect } from "next/navigation";
import { resolveRouteStoreId } from "../route-store";

export default async function AlertsAliasPage() {
    const storeId = await resolveRouteStoreId();
    redirect(`/dashboard/${storeId}/alerts`);
}
