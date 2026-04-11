import { redirect } from "next/navigation";
import { resolveRouteStoreId } from "../route-store";

export default async function VitalSignsAliasPage() {
    const storeId = await resolveRouteStoreId();
    redirect(`/dashboard/${storeId}/vital-signs`);
}
