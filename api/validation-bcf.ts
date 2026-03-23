import { list } from "@vercel/blob";

export default async function handler(req: Request) {
  const { searchParams } = new URL(req.url);
  const commit = searchParams.get("commit");
  const file = searchParams.get("file");

  if (!commit || !file) {
    return Response.json({ error: "Missing commit or file param" }, { status: 400 });
  }

  const pathname = `validation-results/${commit}_${file}.bcf`;
  const stem = pathname.replace(".bcf", "");
  const { blobs } = await list({ prefix: stem });
  const match = blobs.find((b) => b.pathname === pathname);

  if (!match) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const res = await fetch(match.downloadUrl);
  const bytes = await res.arrayBuffer();
  const safeName = file.replace(".ifc", "");

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}-validation.bcf"`,
    },
  });
}
