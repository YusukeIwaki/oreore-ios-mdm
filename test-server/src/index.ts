import { handleRequest } from "./server";

const port = Number(process.env.PORT ?? 4567);
const server = Bun.serve({ port, fetch: handleRequest });

console.log(`test server listening on http://localhost:${server.port}`);
