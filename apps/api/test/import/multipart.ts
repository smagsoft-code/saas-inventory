const BOUNDARY = '----importTestBoundary';

/** Hand-builds a multipart/form-data body for Fastify's `inject()` — light-my-request has no
 * built-in multipart helper, and @fastify/multipart only parses, it doesn't construct. */
export function buildMultipartUpload(params: { fileFieldName?: string; filename: string; contentType: string; fileContent: Buffer; fields?: Record<string, string> }): { body: Buffer; contentType: string } {
  const parts: Buffer[] = [];
  const fieldName = params.fileFieldName ?? 'file';

  for (const [key, value] of Object.entries(params.fields ?? {})) {
    parts.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  }

  parts.push(
    Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${params.filename}"\r\nContent-Type: ${params.contentType}\r\n\r\n`),
  );
  parts.push(params.fileContent);
  parts.push(Buffer.from(`\r\n--${BOUNDARY}--\r\n`));

  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${BOUNDARY}` };
}
