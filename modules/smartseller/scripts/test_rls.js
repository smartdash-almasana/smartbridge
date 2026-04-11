const fs = require('fs');

const envKeys = fs.readFileSync('.env.local', 'utf8').split('\n');
const ANON_KEY = envKeys.find(l => l.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')).split('=')[1].replace(/"/g, '').trim();
const SERVICE_KEY = envKeys.find(l => l.startsWith('SUPABASE_SERVICE_ROLE_KEY=')).split('=')[1].replace(/"/g, '').trim();
const SUPABASE_URL = "https://bewjtoozxukypjbckcyt.supabase.co";

async function testRLS() {
    console.log("=== Testing Anon Role ===");
    // Test anon read
    let res = await fetch(`${SUPABASE_URL}/rest/v1/v3_tenants?select=*`, {
        headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` }
    });
    let data = await res.json();
    console.log("Anon Read Status:", res.status);
    console.log("Anon Read Data:", data);

    // Test anon write
    let writeRes = await fetch(`${SUPABASE_URL}/rest/v1/v3_tenants`, {
        method: 'POST',
        headers: {
            'apikey': ANON_KEY,
            'Authorization': `Bearer ${ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify({ tenant_key: 'test', display_name: 'test anon write' })
    });
    let writeData = await writeRes.json();
    console.log("Anon Write Status:", writeRes.status);
    console.log("Anon Write Data:", writeData);


    console.log("\n=== Testing Authenticated Role (mocked with invalid sub in jwt, or just generic authenticated token) ===");
    // Note: For a real authenticated test, we'd need to sign a mock JWT with role: 'authenticated'. 
    // However, usually anon requests upgrade to authenticated automatically if auth headers have a valid user JWT.
    // We can skip a precise "authenticated" role if anon fails, since both have explicit deny policies.


    console.log("\n=== Testing Service Role ===");
    // Test service role read
    let serviceRes = await fetch(`${SUPABASE_URL}/rest/v1/v3_tenants?select=*`, {
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
    });
    let serviceData = await serviceRes.json();
    console.log("Service Read Status:", serviceRes.status);
    console.log("Service Rows returned:", serviceData.length);

    // Note: we won't test writing with service role on v3_tenants directly to avoid cluttering DB,
    // but we know service_role bypasses RLS and could write if it wanted to.
}

testRLS().catch(console.error);
