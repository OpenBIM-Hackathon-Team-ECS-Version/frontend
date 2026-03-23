import { list } from "@vercel/blob";

export default async function handler() {
  const { blobs } = await list({ prefix: "validation-results/" });

  const results = blobs
    .filter((b) => b.pathname.endsWith(".json"))
    .map((b) => {
      const stem = b.pathname.replace("validation-results/", "").replace(".json", "");
      const idx = stem.indexOf("_");
      return {
        commit: stem.slice(0, idx),
        file: stem.slice(idx + 1),
        uploadedAt: b.uploadedAt,
      };
    });

  return Response.json(results);
}
