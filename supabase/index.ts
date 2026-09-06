import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const headers = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  "Content-Type": "application/json",
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: cors });
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    const { notification_id } = await req.json();
    if (!notification_id) return json({ error: "notification_id required" }, 400);

    const nRes = await fetch(
      `${SUPABASE_URL}/rest/v1/notifications?id=eq.${encodeURIComponent(notification_id)}&select=*`,
      { headers }
    );
    if (!nRes.ok) return json({ error: "notification lookup failed" }, 500);

    const rows = await nRes.json();
    const n = rows[0];
    if (!n) return json({ error: "notification not found" }, 404);

    // The app uses custom MEMBER_xx IDs. Only an admin-created notification is allowed
    // to trigger the server-side push sender.
    if (n.created_by) {
      const creatorRes = await fetch(
        `${SUPABASE_URL}/rest/v1/members?ID=eq.${encodeURIComponent(String(n.created_by))}&select=Role`,
        { headers }
      );
      if (creatorRes.ok) {
        const creators = await creatorRes.json();
        const role = String(creators?.[0]?.Role ?? creators?.[0]?.role ?? "").toLowerCase();
        if (role && role !== "admin") return json({ error: "Only admin-created notifications can send push." }, 403);
      }
    }

    let memberIds: string[] = [];
    if (n.audience === "project") {
      if (!n.project_id) return json({ error: "project_id required" }, 400);
      const pRes = await fetch(
        `${SUPABASE_URL}/rest/v1/projects?id=eq.${encodeURIComponent(n.project_id)}&select=assigned_members,assigned_karyakarta`,
        { headers }
      );
      if (!pRes.ok) return json({ error: "project lookup failed" }, 500);
      const projects = await pRes.json();
      const p = projects[0];
      memberIds = [...new Set([
        ...(Array.isArray(p?.assigned_members) ? p.assigned_members : []),
        ...(Array.isArray(p?.assigned_karyakarta) ? p.assigned_karyakarta : [])
      ].map(String).filter(Boolean))];
      if (!memberIds.length) return json({ notification_id: n.id, attempted: 0, results: [] });
    }

    const selectUrl = n.audience === "all"
      ? `${SUPABASE_URL}/rest/v1/push_subscriptions?select=id,member_id,subscription`
      : `${SUPABASE_URL}/rest/v1/push_subscriptions?select=id,member_id,subscription&member_id=in.(${memberIds.map(encodeURIComponent).join(",")})`;

    const sRes = await fetch(selectUrl, { headers });
    if (!sRes.ok) return json({ error: "subscription lookup failed" }, 500);
    const subs = await sRes.json();

    const payload = JSON.stringify({
      title: n.title,
      body: n.message,
      notificationId: n.id,
      url: "/",
      tag: `notification-${n.id}`,
    });

    const results = await Promise.allSettled(subs.map(async (row: any) => {
      try {
        await webpush.sendNotification(row.subscription, payload);
        return { id: row.id, member_id: row.member_id, ok: true };
      } catch (error: any) {
        const status = error?.statusCode;
        if (status === 404 || status === 410) {
          await fetch(
            `${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(row.id)}`,
            { method: "DELETE", headers }
          );
        }
        return { id: row.id, member_id: row.member_id, ok: false, status: status || 500 };
      }
    }));

    return json({
      notification_id: n.id,
      audience: n.audience,
      project_id: n.project_id || null,
      attempted: results.length,
      results: results.map((r: any) => r.status === "fulfilled" ? r.value : ({ ok: false, status: 500 })),
    });
  } catch (error) {
    console.error(error);
    return json({ error: "Unexpected server error" }, 500);
  }
});
