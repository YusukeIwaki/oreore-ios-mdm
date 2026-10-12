/**
 * Account-driven enrollment discovery (ported from `testaccount.rb`).
 *
 * Serves `/.well-known/com.apple.remotemanagement`: iOS 17+ devices ask with
 * `model-family` and get the ADDE (device enrollment) URL, older ones get the
 * BYOD (user enrollment) URL.
 */
export function handleRequest(req: Request): Response {
  const url = new URL(req.url);
  if (url.pathname !== "/.well-known/com.apple.remotemanagement") {
    return new Response("Not Found", { status: 404 });
  }

  const baseUrl = process.env.MDM_SERVER_BASE_URL ?? "";
  const email = url.searchParams.get("user-identifier") ?? "";
  const deviceFamily = url.searchParams.get("model-family") ?? "";

  if (deviceFamily) {
    console.log(
      `Device Enrollment capable enrollment request with email=${email} device_family=${deviceFamily}`,
    );
    return Response.json({
      Servers: [{ Version: "mdm-adde", BaseURL: `${baseUrl}/mdm-adde/enroll` }],
    });
  }

  console.log(`User Enrollment request with email=${email}`);
  return Response.json({
    Servers: [{ Version: "mdm-byod", BaseURL: `${baseUrl}/mdm-byod/enroll` }],
  });
}
