import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Proxy endpoint to forward a multipart/form-data upload to a local IPFS node.
 *
 * - Accepts POST multipart/form-data requests from the browser.
 * - Buffers the incoming request body (bodyParser disabled) and forwards it to the local IPFS HTTP API (/api/v0/add).
 * - Forwards the IPFS response back to the client as plain text.
 *
 * Notes:
 * - This implementation buffers the entire request body in memory. That's acceptable for small test/demo uploads,
 *   but for production or large files you should stream the request instead of buffering.
 * - The local IPFS node must be reachable at http://127.0.0.1:5001. If you run IPFS in Docker, ensure the container
 *   exposes the API port to the host and that the Next server can reach it.
 */

export const config = {
  api: {
    bodyParser: false, // we need the raw request body
  },
};

async function collectRequestBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => {
      reject(err);
    });
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    // Collect raw body from incoming request
    const rawBody = await collectRequestBody(req);

    // Forward to local IPFS API
    const ipfsApiUrl = process.env.IPFS_API_URL ?? "http://127.0.0.1:5001/api/v0/add";

    // Preserve content-type header so go-ipfs can parse the multipart form
    const contentType = req.headers["content-type"] ?? "multipart/form-data";

    const ipfsRes = await fetch(ipfsApiUrl, {
      method: "POST",
      headers: {
        // Forward the original content-type (includes boundary)
        "content-type": Array.isArray(contentType) ? contentType[0] : contentType,
        // Forward content-length if available
        ...(rawBody.length ? { "content-length": String(rawBody.length) } : {}),
      },
      // Use a Uint8Array view for the raw body so the Fetch typings accept the body (BodyInit)
      // This avoids the TS error where Buffer is not assignable to BodyInit in some lib types.
      body: new Uint8Array(rawBody),
    });

    const text = await ipfsRes.text();

    // Return IPFS response status and body as-is (text/plain)
    res.status(ipfsRes.status);
    // Mirror content-type from IPFS if present, otherwise plain text
    const ipfsContentType = ipfsRes.headers.get("content-type") ?? "text/plain";
    res.setHeader("content-type", ipfsContentType);
    res.send(text);
  } catch (err: any) {
    // Provide a non-silent fallback message for the client, including the error.
    // Client code may choose to use a simulated CID if this endpoint fails.
    console.error("IPFS proxy /api/ipfs/add error:", err);
    res.status(500).json({
      error: "IPFS proxy error",
      message: String(err?.message ?? err),
    });
  }
}
