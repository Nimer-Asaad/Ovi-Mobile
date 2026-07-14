import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

/** Local-disk storage for product media, under public/uploads/products/ so
 * Next.js serves it as a static asset at /uploads/products/<filename>. This
 * is a local/dev (or simple single-server hosting) strategy only — once the
 * app moves to a managed database/hosting setup, uploaded media should be
 * migrated to object storage (Supabase Storage, S3, Cloudinary, etc.)
 * instead of the server's local filesystem. */
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "products");
const PUBLIC_PATH_PREFIX = "/uploads/products";

/** Writes an already-validated file to disk under a server-generated
 * filename (never derived from the client's original filename) and returns
 * its public URL path to store in the database. */
export async function saveUploadedProductFile(file: File, extension: string): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });

  const filename = `${randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, filename), buffer);

  return `${PUBLIC_PATH_PREFIX}/${filename}`;
}
